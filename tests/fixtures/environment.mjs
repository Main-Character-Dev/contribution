import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

// Preload in each test process. Product subprocesses intentionally discard
// inherited GIT_CONFIG_* variables; this test-only executable restores the
// fixture configuration after that boundary, without changing product code.
const root = mkdtempSync(join(tmpdir(), 'ct-test-environment-'));
const config = join(root, 'gitconfig'), bin = join(root, 'bin'), templates = join(root, 'templates');
mkdirSync(bin); mkdirSync(templates); mkdirSync(join(templates, 'hooks'));
writeFileSync(config, '[user]\n\tname = Fixture Author\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
writeFileSync(join(bin, 'git'), `#!/bin/sh\nexport GIT_CONFIG_GLOBAL=${quote(config)}\nexport GIT_CONFIG_NOSYSTEM=1\nexport GIT_TEMPLATE_DIR=${quote(templates)}\nexec /usr/bin/git "$@"\n`, { mode: 0o700 });
for (const key of Object.keys(process.env)) if (/^GIT_(?:DIR$|COMMON_DIR$|WORK_TREE$|INDEX_FILE$|OBJECT_DIRECTORY$|ALTERNATE_OBJECT_DIRECTORIES$|NAMESPACE$|PREFIX$|CONFIG(?:$|_)|REPLACE_REF_BASE$|TEMPLATE_DIR$)/.test(key)) delete process.env[key];
process.env.GIT_CONFIG_GLOBAL = config;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_TEMPLATE_DIR = templates;
process.env.PATH = bin + delimiter + process.env.PATH;
process.on('exit', () => rmSync(root, { recursive: true, force: true }));

export const gitEnvironment = () => ({ GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_TEMPLATE_DIR: templates });
