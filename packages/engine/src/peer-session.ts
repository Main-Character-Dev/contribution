import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { assertContract } from '@contribution/contracts';
import type { Response } from '@contribution/contracts';
import { Fault, object, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import { run } from './process.js';
import type { ProcessOwnership, ProcessResult } from './process.js';
import { sshArguments, transportFailure } from './peer-connectivity.js';

/** One finite owned SSH/helper process, with at most four requests in flight.
 * Replies acknowledge the ordinary durable receiver, never buffered bytes. */
export class PeerSession {
  private stream: Writable | undefined;
  private readonly ready: Promise<void>;
  private readonly done: Promise<ProcessResult>;
  private pending: { resolve: (reply: Response) => void; reject: (error: unknown) => void }[] = [];
  private readonly controller = new AbortController();
  private closing = false;
  private windowBusy = false;
  private settled = false;
  private idle: NodeJS.Timeout | undefined;
  private protocolFailure: Fault | undefined;
  constructor(alias: string, ownership: ProcessOwnership | undefined, runner = run) {
    let ready: () => void, unavailable: (error: unknown) => void;
    this.ready = new Promise<void>((resolve, reject) => { ready = resolve; unavailable = reject; });
    const decoder = new StringDecoder('utf8'); let buffer = '';
    this.done = runner('/usr/bin/ssh', [...sshArguments(alias).slice(0, -1), '"$HOME/.local/bin/contribution" peer --stdio-session'], {
      ...(ownership ? { ownership } : {}), timeoutMs: 300000, maxBytes: 8 * 1024 ** 2, outputLineBytes: 2 * 1024 ** 2, signal: this.controller.signal,
      inputStream: stream => { this.stream = stream; ready(); },
      stdoutSink: { maxBytes: 8 * 1024 ** 2, write: data => {
        if (this.protocolFailure) return;
        try {
        buffer += decoder.write(data);
        requireValue(Buffer.byteLength(buffer) <= 2 * 1024 ** 2, 'PEER_PROTOCOL_ERROR', 'Session response exceeds its finite frame bound.', 3);
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          requireValue(Buffer.byteLength(line) <= 2 * 1024 ** 2, 'PEER_PROTOCOL_ERROR', 'Session response exceeds its finite frame bound.', 3);
          const response = JSON.parse(line) as Response; assertContract('response', response);
          const pending = this.pending.shift(); requireValue(pending, 'PEER_PROTOCOL_ERROR', 'Session returned an unsolicited reply.', 3); pending.resolve(response);
        }
        } catch { this.protocolFailure = new Fault('PEER_PROTOCOL_ERROR', 'The peer session returned an invalid or oversized frame.', 3); this.controller.abort(); }
      } }
    });
    void this.done.then(result => {
      this.settled = true; this.closing = true; if (this.idle) clearTimeout(this.idle);
      const error = result.cleanup?.released === false ? transportFailure(result) : this.protocolFailure ?? transportFailure(result); unavailable(error);
      for (const pending of this.pending.splice(0)) pending.reject(error);
    }, error => { this.settled = true; this.closing = true; if (this.idle) clearTimeout(this.idle); unavailable(error); for (const pending of this.pending.splice(0)) pending.reject(error); });
    // A failed startup is consumed by requestMany, without a detached rejection.
    void this.ready.catch(() => {});
  }
  get closed(): boolean { return this.closing; }
  get drained(): boolean { return this.settled; }
  async requestMany(envelopes: ObjectValue[], signal?: AbortSignal): Promise<ObjectValue[]> {
    requireValue(envelopes.length > 0 && envelopes.length <= 4 && !this.windowBusy && !this.pending.length && !this.closing, 'PEER_SESSION_BUSY', 'Session windows contain one to four requests.', 4);
    if (this.idle) clearTimeout(this.idle);
    const frames = envelopes.map(envelope => JSON.stringify(envelope) + '\n');
    requireValue(frames.every(frame => Buffer.byteLength(frame) <= 1024 ** 2), 'FRAME_TOO_LARGE', 'Peer session request exceeds one MiB.', 2);
    this.windowBusy = true;
    const cancel = (): void => this.controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) cancel(); await this.ready;
      requireValue(!this.closing && !signal?.aborted, 'PROBE_CANCELLED', 'The peer session was cancelled before its next window.', 3);
      const replies = frames.map(frame => new Promise<Response>((resolve, reject) => { this.pending.push({ resolve, reject }); this.stream!.write(frame); }));
      const received = await Promise.all(replies);
      return received.map(response => { if (response.error) throw new Fault(response.error.code, response.error.message, 3, response.result ?? {}, response.error.retryable); return object(response.result); });
    } catch (error) { await this.close(); throw error; }
    finally { this.windowBusy = false; signal?.removeEventListener('abort', cancel); if (!this.closing) this.idle = setTimeout(() => { void this.close().catch(() => {}); }, 2000); }
  }
  async close(): Promise<void> {
    if (this.idle) clearTimeout(this.idle); this.closing = true;
    this.stream?.end(); const result = await this.done;
    if (result.cleanup?.released === false) throw transportFailure(result);
  }
}
