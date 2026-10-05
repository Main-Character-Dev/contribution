import { mkdirSync, lstatSync, readdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reportingEnvironment, reportingPatch } from '@contribution/adapters';
import { digest, requireValue, now, id } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import { identity, gitText } from './git.js';

interface AttemptPaths { directory: string; statusLog: string; summaryLog: string; repairJson: string; repairPrompt: string; archive: string }
interface Attempt { operationId: string; attemptId: string; repositoryId: string; adapter: string; paths: AttemptPaths; createdAt: string }
const seams: Record<string, string | null> = { 'mathy-v1': 'scripts/lib/pre-push-reporting.mjs', 'maincharacter-v1': '.husky/pre-push', 'roboty-v1': 'scripts/local-pre-push.mjs', 'glassalpha-v1': null };

/** Allocation grants no hook, writer, check or publication authority. */
export class LegacyReporting {
  constructor(readonly store: Journal) {}
  allocate(op: Operation, repo: Enrolled): { paths: AttemptPaths; environment: Record<string, string> } {
    requireValue(op.repositoryId === repo.id && Object.hasOwn(seams, repo.config.validation.adapter), 'ADAPTER_UNKNOWN', 'Select the matching adopted project reporting owner.');
    const adapter = repo.config.validation.adapter;
    let retained = this.store.record<Attempt>('legacyAttempt', op.attemptId);
    if (!retained) {
      const parent = join(this.store.directory, 'legacy-attempts'); mkdirSync(parent, { recursive: true, mode: 0o700 }); this.directory(parent);
      const directory = join(parent, op.attemptId), paths = { directory, statusLog: join(directory, 'status.log'), summaryLog: join(directory, 'summary.log'), repairJson: join(directory, 'repair.json'), repairPrompt: join(directory, 'repair.txt'), archive: join(directory, 'repairs') };
      requireValue(!existsSync(directory), 'ATTEMPT_EVIDENCE_CONFLICT', 'An unacknowledged attempt directory exists. Preserve its evidence before recovery.', 3);
      mkdirSync(directory, { mode: 0o700 }); this.sync(parent);
      retained = { operationId: op.operationId, attemptId: op.attemptId, repositoryId: repo.id, adapter, paths, createdAt: now() };
      this.store.put('legacyAttempt', op.attemptId, retained);
    }
    requireValue(retained.operationId === op.operationId && retained.repositoryId === repo.id && retained.adapter === adapter, 'ATTEMPT_EVIDENCE_CONFLICT', 'The attempt belongs to another operation or reporting policy.');
    this.directory(retained.paths.directory);
    return { paths: retained.paths, environment: reportingEnvironment(adapter, retained.paths) };
  }
  seal(op: Operation): ObjectValue {
    const attempt = this.store.record<Attempt>('legacyAttempt', op.attemptId);
    requireValue(attempt?.operationId === op.operationId, 'ATTEMPT_EVIDENCE_MISSING', 'Allocate a distinct reporting attempt before retaining its results.');
    const prior = this.store.record<ObjectValue>('legacyEvidence', op.attemptId); if (prior) return prior;
    const entries: { relative: string; bytes: Buffer }[] = []; let total = 0, directories = 0;
    const visit = (directory: string, depth = 0): void => {
      this.directory(directory);
      requireValue(++directories <= 100, 'ATTEMPT_EVIDENCE_LIMIT', 'Too many reporting directories to seal.');
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name), info = lstatSync(path);
        requireValue(!info.isSymbolicLink() && info.uid === process.getuid?.(), 'ATTEMPT_EVIDENCE_INVALID', 'Foreign or linked reporting output is retained for inspection, never followed.');
        if (info.isDirectory()) { requireValue(depth < 2 && (depth > 0 || path === attempt.paths.archive), 'ATTEMPT_EVIDENCE_INVALID', 'Unexpected nested reporting output.'); visit(path, depth + 1); continue; }
        total += info.size;
        requireValue(info.isFile() && info.nlink === 1 && info.size <= 8 * 1024 * 1024 && total <= 16 * 1024 * 1024 && entries.length < 100, 'ATTEMPT_EVIDENCE_LIMIT', 'Legacy reporting exceeded its retained evidence limit or uses shared files. Preserve it for inspection.');
        const bytes = readFileSync(path); requireValue(bytes.length === info.size, 'ATTEMPT_EVIDENCE_CHANGED', 'Reporting output is still changing.');
        entries.push({ relative: path.slice(attempt.paths.directory.length + 1), bytes });
      }
    };
    visit(attempt.paths.directory);
    const parent = join(this.store.directory, 'legacy-evidence'); mkdirSync(parent, { recursive: true, mode: 0o700 }); this.directory(parent);
    const snapshot = join(parent, id()); mkdirSync(snapshot, { mode: 0o700 });
    const files = entries.map(entry => {
      const path = join(snapshot, entry.relative); mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(path, entry.bytes, { flag: 'wx', mode: 0o400 }); this.sync(path); this.sync(join(path, '..'));
      return { path: entry.relative, bytes: entry.bytes.length, sha256: digest(entry.bytes) };
    });
    this.sync(snapshot); this.sync(parent);
    const evidence = { operationId: op.operationId, attemptId: op.attemptId, repositoryId: attempt.repositoryId, adapter: attempt.adapter, snapshot, files, observedAt: now(), interpretation: 'retained_output_only' };
    this.store.put('legacyEvidence', op.attemptId, evidence); return evidence;
  }
  async proposal(repo: Enrolled, requestId: string, adapter = repo.config.validation.adapter): Promise<ObjectValue> {
    const sourcePath = seams[adapter];
    requireValue(sourcePath !== undefined, 'ADAPTER_UNKNOWN', 'This project has no adopted reporting migration.');
    const prior = this.store.record<{ repo: string; adapter: string; result: ObjectValue }>('legacyReportingProposal', requestId);
    if (prior) { requireValue(prior.repo === repo.id && prior.adapter === adapter, 'REQUEST_ID_CONFLICT', 'This proposal request belongs to a different project or adapter.'); return prior.result; }
    const intent = this.store.record<{ repo: string; adapter: string }>('legacyReportingProposalIntent', requestId);
    requireValue(!intent || (intent.repo === repo.id && intent.adapter === adapter), 'REQUEST_ID_CONFLICT', 'This proposal identity was retained for another selection.');
    requireValue(!intent, 'MIGRATION_PROPOSAL_PENDING', 'This proposal is still preparing or was interrupted. Preserve it; use a new request identity for a fresh review.', 3);
    const proposalId = id(); this.store.put('legacyReportingProposalIntent', requestId, { repo: repo.id, adapter, proposalId, at: now() });
    const source = await identity(repo.path), original = sourcePath ? this.readSource(repo.path, sourcePath) : '';
    const patch = reportingPatch(adapter, original), parent = join(this.store.directory, 'migration-proposals'), directory = join(parent, proposalId);
    mkdirSync(parent, { recursive: true, mode: 0o700 }); this.directory(parent); mkdirSync(directory, { mode: 0o700 });
    const before = join(directory, 'before.txt'), after = join(directory, 'after.txt');
    writeFileSync(before, original, { flag: 'wx', mode: 0o600 }); writeFileSync(after, patch.source, { flag: 'wx', mode: 0o600 }); this.sync(before); this.sync(after); this.sync(directory); this.sync(parent);
    requireValue((await identity(repo.path)).tip === source.tip && (!sourcePath || this.readSource(repo.path, sourcePath) === original), 'MIGRATION_SOURCE_CHANGED', 'Project source changed during proposal generation. The private snapshot remains retained; generate a new proposal.', 3);
    const result = { proposalId, repositoryId: repo.id, adapter, sourceTip: source.tip, sourceBranch: source.branch, hookOwner: (await gitText(repo.path, ['config', '--get', 'core.hooksPath']).catch(() => 'default')),
      stage: 'reporting_only', sourcePath: sourcePath ?? null, beforeDigest: digest(original), afterDigest: digest(patch.source), replacements: patch.replacements,
      privateReview: { before, after }, mutation: 'none', activation: 'blocked_pending_hook_and_writer_adoption', gate: repo.config.validation.gate };
    this.store.put('legacyReportingProposal', requestId, { repo: repo.id, adapter, result }); return result;
  }
  private readSource(root: string, path: string): string {
    let current = root;
    for (const segment of path.split('/')) { current = join(current, segment); requireValue(!lstatSync(current).isSymbolicLink(), 'MIGRATION_SOURCE_INVALID', 'Reporting sources must not traverse symbolic links.'); }
    const info = lstatSync(current); requireValue(info.isFile() && info.size <= 1024 * 1024 && resolve(current).startsWith(resolve(root) + '/'), 'MIGRATION_SOURCE_INVALID', 'Reporting source must be a bounded project file.');
    return readFileSync(current, 'utf8');
  }
  private directory(path: string): void { const info = lstatSync(path); requireValue(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0, 'ATTEMPT_EVIDENCE_INVALID', 'The private attempt directory has changed.'); }
  private sync(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
}
