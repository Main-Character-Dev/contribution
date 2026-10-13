import { spawnSync } from 'node:child_process';

const prerequisite = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
if (prerequisite.error || prerequisite.status !== 0) {
  console.error('Secret scanner tests require Gitleaks (validated with 8.30.1). Install it with brew install gitleaks.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--import', './tests/fixtures/environment.mjs', '--test', 'scripts/scan-secrets.test.mjs'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
