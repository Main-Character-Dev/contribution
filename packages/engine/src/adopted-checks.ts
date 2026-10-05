import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, Fault, requireValue } from './core.js';
import type { ObjectValue } from './core.js';
import type { Journal, Operation } from './journal.js';
import type { Enrolled } from './repositories.js';
import type { AdoptedHooks } from './adopted-hooks.js';
import { contained, identity, inputFingerprint, gitText } from './git.js';
import { ProjectRuntimes } from './project-runtime.js';
import { run } from './process.js';
import type { RunOptions } from './process.js';

export interface AdoptedCheckSelection {
  adapter: string; id: string; path: string; argv: string[]; sourcePath: string; dirty: boolean;
  purpose: 'local_checks' | 'landing_policy' | 'focused_tests'; sourceProgramDigest: string; adoptionDigest: string; fresh: boolean;
}
/** Calls preserved project check entry points in the explicitly selected local
 * checkout. This class never supplies a push scope, hook borrow or gate receipt. */
export class AdoptedChecks {
  readonly runtimes: ProjectRuntimes;
  constructor(readonly store: Journal, readonly hooks: AdoptedHooks) { this.runtimes = new ProjectRuntimes(store); }
  async select(repo: Enrolled, sourcePath: string, requested: unknown, fresh: boolean): Promise<AdoptedCheckSelection> {
    const adapter = repo.config.validation.adapter, adoption = await this.hooks.verify(repo), source = await identity(sourcePath);
    requireValue(source.commonDir === repo.commonDir, 'SOURCE_OWNERSHIP_REQUIRED', 'Local checks must use the selected enrolled clone.', 3);
    requireValue(requested === null || requested === undefined || typeof requested === 'string' && requested.length <= 1024, 'INVALID_CHECK_ID', 'Use a bounded original check selector.', 2);
    const id = typeof requested === 'string' ? requested : adapter === 'mathy-v1' ? 'check' : 'changed';
    const dirty = Boolean(await gitText(source.path, ['status', '--porcelain=v1', '--untracked-files=all']));
    let path: string, argv: string[], purpose: AdoptedCheckSelection['purpose'] = 'local_checks', supportsDirty = false;
    if (adapter === 'mathy-v1') {
      path = 'scripts/validation-profile.mjs'; supportsDirty = true;
      if (id.startsWith('test-path:')) {
        const test = id.slice('test-path:'.length);
        requireValue(!test.split('/').some(part => part === '..' || part === '.' || !part) && /^(?:tests\/[^\n\r\0]+|scripts\/[^/]+\.test\.mjs)$/.test(test), 'CHECK_NOT_SELECTED', 'Mathy focused tests require an explicit tests/ path or scripts/*.test.mjs path.', 2);
        const file = lstatSync(contained(source.path, test)); requireValue(file.isFile() || file.isDirectory(), 'CHECK_NOT_SELECTED', 'Select an existing local test path.', 2);
        argv = ['iteration', test]; purpose = 'focused_tests';
      } else {
        requireValue(id === 'check' || id === 'landing-policy', 'CHECK_NOT_SELECTED', 'Mathy local selectors are check, landing-policy, or test-path:<path>. Exact-range pre-push repair remains with its original command.', 2);
        argv = [id === 'landing-policy' ? 'landing' : 'check']; if (fresh) argv.push('--fresh');
        if (id === 'landing-policy') purpose = 'landing_policy';
      }
    } else if (adapter === 'maincharacter-v1') {
      requireValue(['changed', 'lint', 'typecheck', 'test'].includes(id), 'CHECK_NOT_SELECTED', 'Main Character local selectors are changed, lint, typecheck, and test. Use the original focused pre-push repair for a publication check ID.', 2);
      path = 'scripts/run-changed-checks.mjs'; argv = ['--mode', id === 'changed' ? 'all' : id]; if (fresh) argv.push('--fresh');
    } else if (adapter === 'roboty-v1') {
      requireValue(id === 'changed' || /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(id), 'CHECK_NOT_SELECTED', 'Select changed or an original Roboty check ID.', 2);
      path = 'scripts/run-changed-checks.mjs'; argv = id === 'changed' ? [] : ['--only-check', id]; if (fresh) argv.push('--fresh'); supportsDirty = true;
    } else {
      requireValue(adapter === 'glassalpha-v1' && ['changed', 'test'].includes(id), 'CHECK_NOT_SELECTED', 'Glass Alpha local selectors are changed and test. Its publication gate stays inactive.', 2);
      path = 'scripts/run-changed-checks.mjs'; argv = ['--mode', id === 'changed' ? 'all' : 'test'];
    }
    requireValue(!dirty || supportsDirty, 'DIRTY_CHECK_SOURCE_UNSUPPORTED', 'This original change selector uses committed history and cannot certify dirty inputs. Preserve the edits and commit the intended source or use its explicit project test command.', 3);
    const file = contained(source.path, path), stat = lstatSync(file);
    requireValue(stat.isFile() && stat.size <= 4 * 1024 * 1024, 'CHECK_SOURCE_UNAVAILABLE', 'The original local check program is missing or exceeds the supported bound.', 3);
    return { adapter, id, path, argv, sourcePath: source.path, dirty, purpose, sourceProgramDigest: digest(readFileSync(file)), adoptionDigest: digest(adoption), fresh };
  }
  async execute(op: Operation, repo: Enrolled, sourcePath: string, options: RunOptions): Promise<ObjectValue> {
    const selected = await this.select(repo, sourcePath, op.input['checkId'], op.input['fresh'] === true);
    requireValue(digest(selected) === digest(op.input['adoptedCheck']), 'CHECK_SELECTION_CHANGED', 'The original local check selection or adoption changed after admission.', 3);
    const before = await inputFingerprint(sourcePath), source = await identity(sourcePath), runtime = await this.runtimes.resolve(repo, sourcePath), env = this.runtimes.environment(runtime);
    for (const key of Object.keys(process.env)) if (key.startsWith('CONTRIBUTION_') || key.startsWith('CODEX_') || /^(MC|ROBOTY|MATHY)_.*(?:PRE_PUSH|VALIDATION_)/.test(key)) env[key] = undefined;
    requireValue(before === op.input['fingerprint'] && source.tip === op.input['sourceTip'] && await inputFingerprint(sourcePath) === before && (await identity(sourcePath)).tip === source.tip,
      'SOURCE_CHANGED', 'The selected local source changed before its original check could start.', 3);
    requireValue(digest(await this.hooks.verify(repo)) === selected.adoptionDigest, 'CHECK_SELECTION_CHANGED', 'The original adoption changed before local execution.', 3);
    this.store.log(op, `[original local check] ${selected.id}; purpose=${selected.purpose}; dirty=${selected.dirty}; publication=not_requested\n`);
    const command = { executable: runtime.node, argv: [join(selected.sourcePath, selected.path), ...selected.argv], cwd: selected.sourcePath };
    this.store.update(this.store.get(op.operationId), { stage: 'original_local_checks', result: { originalCheck: selected, command, sourceTip: source.tip, inputDigest: before, executionHostId: this.store.hostId,
      publication: 'not_requested', gate: { state: repo.config.validation.gate === 'inactive' ? 'inactive' : 'not_run' }, reuse: 'not_publication_proof' } });
    // Preserve original per-check deadlines; this outer bound only contains an
    // abandoned runner. Child-native/simulator coordination stays project-owned.
    const result = await run(command.executable, command.argv, { ...options, env, cwd: command.cwd, timeoutMs: 24 * 60 * 60 * 1000 });
    const unchanged = (await identity(sourcePath)).tip === source.tip && await inputFingerprint(sourcePath) === before;
    const outcome = { exitCode: result.code, cancelled: result.cancelled, timedOut: result.timedOut, sourceUnchanged: unchanged,
      childOutcomes: 'original_project_output', publicationProof: false };
    this.store.put('adoptedCheckResult', op.operationId, outcome);
    if (result.cancelled) throw new Fault('CANCELLED', 'The original local check was cancelled.', 130, { originalCheckOutcome: outcome });
    if (!unchanged) throw new Fault('CHECK_INPUT_CHANGED', 'Local inputs changed during the original check. Its output is retained, but it is not reusable input proof.', 5, { originalCheckOutcome: outcome });
    if (result.code !== 0 || result.timedOut) throw new Fault('CHECK_FAILED', 'The original project check failed. Its own focused repair details remain in this attempt’s output.', 5, { originalCheckOutcome: outcome });
    return { state: 'completed', originalCheckOutcome: outcome, checks: [{ id: selected.id, state: 'completed', scope: 'original_runner', childOutcomes: 'original_project_output' }] };
  }
}
