import { validateContractFormat } from '@contribution/contracts';
import { boundedOwnerCall } from './resource-owner.js';
import type { Journal } from './journal.js';
import { digest, now, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
export interface NativeAttachment { identityKey: string; ownerChatId: string; hostId: string; generation: string; retainedHistory: boolean; integrated: boolean; completed: boolean; ignoredFilesPreserved: boolean }
export interface NativeWorktreeOwner {
  inventory(): Promise<NativeAttachment[]>;
  archive(identityKey: string, guard: () => void): Promise<void>;
}
/** Native paths and Codex's ownership database are never cleanup operands. */
export class NativeWorktreeCloseout {
  constructor(readonly store: Journal, readonly owner?: NativeWorktreeOwner) {}
  instruction(attachment: NativeAttachment): ObjectValue { return { identityKey: attachment.identityKey, ownerChatId: attachment.ownerChatId, hostId: attachment.hostId,
    action: 'Ask this exact owning chat to verify completed/integrated history and preserve needed ignored files, then archive its attachment with Codex’s normal managed-worktree operation.', authority: 'owning_chat_only' }; }
  async archive(attachment: NativeAttachment, callerChatId: string, requestId: string): Promise<ObjectValue> {
    requireValue(validateContractFormat('uuid', requestId), 'INVALID_USAGE', 'Use an immutable native closeout request UUID.', 2);
    if (!this.owner) return { supported: false, ...this.instruction(attachment) };
    requireValue(callerChatId === attachment.ownerChatId && attachment.hostId === this.store.hostId && attachment.completed && attachment.integrated && attachment.retainedHistory && attachment.ignoredFilesPreserved,
      'NATIVE_WORKTREE_PROTECTED', 'Only the exact owning chat may close a completed, integrated and recoverable attachment.', 3);
    const selected = digest(attachment), prior = this.store.record<{ selected: string; state: string; result?: ObjectValue }>('nativeCloseout', requestId);
    if (prior) { requireValue(prior.selected === selected, 'REQUEST_ID_CONFLICT', 'Native closeout selected another attachment.'); if (prior.result) return prior.result; }
    const current = (await boundedOwnerCall(() => this.owner!.inventory(), new AbortController().signal)).find(a => a.identityKey === attachment.identityKey);
    if (!current && prior) return { supported: true, unconfirmed: true, ...this.instruction(attachment) }; // lost reply is not a second archive grant
    requireValue(current && digest(current) === selected, 'NATIVE_ATTACHMENT_CHANGED', 'The native attachment changed; preserve it.', 3);
    requireValue(!prior, 'NATIVE_CLOSEOUT_UNCONFIRMED', 'Observe the original owning-tool result before repeating native archival.', 3);
    this.store.put('nativeCloseout', requestId, { selected, state: 'archiving', attachment, startedAt: now() });
    await boundedOwnerCall(signal => this.owner!.archive(attachment.identityKey, () => { const row = this.store.record<{ selected: string; state: string }>('nativeCloseout', requestId); requireValue(!signal.aborted && row?.selected === selected && row.state === 'archiving', 'NATIVE_ATTACHMENT_CHANGED', 'The retained native grant changed.', 3); }), new AbortController().signal);
    requireValue(!(await boundedOwnerCall(() => this.owner!.inventory(), new AbortController().signal)).some(a => a.identityKey === attachment.identityKey), 'NATIVE_CLOSEOUT_UNCONFIRMED', 'Owning tool has not confirmed archival.', 3);
    const result = { supported: true, archived: attachment.identityKey, ownerChatId: callerChatId, requestId };
    this.store.put('nativeCloseout', requestId, { selected, state: 'completed', result }); return result;
  }
}
