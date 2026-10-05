/** Change reporting destinations only; preserve the project's gate owner. */
export function reportingPatch(adapter: string, source: string): { source: string; replacements: number } {
  let result = source, replacements = 0;
  const replace = (before: string, after: string): void => {
    if (result.split(before).length !== 2) throw new Error('The inspected reporting seam changed; review current source before migration.');
    result = result.replace(before, after); replacements++;
  };
  if (adapter === 'mathy-v1') {
    replace('failureArchive: path.join(logDirectory, `${EVIDENCE_PREFIX}-failures`),', 'failureArchive: environment.MATHY_PRE_PUSH_FAILURE_ARCHIVE || path.join(logDirectory, `${EVIDENCE_PREFIX}-failures`),');
  } else if (adapter === 'roboty-v1') {
    replace('export function resolvePrePushEvidencePaths(cwd = process.cwd()) {', 'export function resolvePrePushEvidencePaths(cwd = process.cwd(), environment = process.env) {');
    for (const [key, suffix, env] of [
      ['statusLog', 'pre-push-latest.log', 'STATUS_LOG'], ['summaryLog', 'pre-push-summary-latest.log', 'SUMMARY_LOG'],
      ['repairJson', 'pre-push-repair-latest.json', 'REPAIR_JSON'], ['repairPrompt', 'pre-push-repair-latest.txt', 'REPAIR_PROMPT'],
      ['repairArchive', 'pre-push-repairs', 'REPAIR_ARCHIVE_DIR'],
    ]) replace(`${key}: path.join(logDirectory, "${suffix}"),`, `${key}: environment.ROBOTY_PRE_PUSH_${env} || path.join(logDirectory, "${suffix}"),`);
  } else if (!['maincharacter-v1', 'glassalpha-v1'].includes(adapter)) throw new Error('Unknown reporting adapter.');
  return { source: result, replacements };
}
export function reportingEnvironment(adapter: string, paths: { statusLog: string; summaryLog: string; repairJson: string; repairPrompt: string; archive: string }): Record<string, string> {
  if (adapter === 'glassalpha-v1') return {};
  const prefix = adapter === 'mathy-v1' ? 'MATHY' : adapter === 'maincharacter-v1' ? 'CODEX' : adapter === 'roboty-v1' ? 'ROBOTY' : null;
  if (!prefix) throw new Error('Unknown reporting adapter.');
  return { [`${prefix}_PRE_PUSH_STATUS_LOG`]: paths.statusLog, [`${prefix}_PRE_PUSH_SUMMARY_LOG`]: paths.summaryLog,
    [`${prefix}_PRE_PUSH_REPAIR_JSON`]: paths.repairJson, [`${prefix}_PRE_PUSH_REPAIR_PROMPT`]: paths.repairPrompt,
    [`${prefix}_PRE_PUSH_${adapter === 'mathy-v1' ? 'FAILURE_ARCHIVE' : 'REPAIR_ARCHIVE_DIR'}`]: paths.archive };
}
