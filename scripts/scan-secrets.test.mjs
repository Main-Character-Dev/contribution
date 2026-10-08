import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scanner = fileURLToPath(new URL("./scan-secrets.mjs", import.meta.url));
function fixture(fn) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "secret-scan-test-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Scanner fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("commit", "--allow-empty", "-qm", "base");
    fn(cwd, git);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
function run(cwd, args, input = "") {
  return spawnSync(process.execPath, [scanner, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, GITLEAKS_CONFIG: "/nonexistent-config" },
  });
}
const secret = "ghp_" + "aB7cD9eF2gH4jK6mN8pQ0rS1tU3vW5xY7zA9";
test("outgoing history catches a secret removed in a later commit and redacts it", () =>
  fixture((cwd, git) => {
    const base = git("rev-parse", "HEAD");
    writeFileSync(path.join(cwd, "fixture.txt"), `token=${secret}\n`);
    git("add", "fixture.txt");
    git("commit", "-qm", "synthetic secret");
    writeFileSync(path.join(cwd, "fixture.txt"), "removed\n");
    git("add", "fixture.txt");
    git("commit", "-qm", "remove secret");
    const head = git("rev-parse", "HEAD");
    const r = run(
      cwd,
      ["--push"],
      `refs/heads/main ${head} refs/heads/main ${base}\n`,
    );
    assert.equal(r.status, 1);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(secret));
  }));
test("staged scan catches new secrets", () =>
  fixture((cwd, git) => {
    writeFileSync(path.join(cwd, "fixture.txt"), `token=${secret}\n`);
    git("add", "fixture.txt");
    assert.equal(run(cwd, ["--staged"]).status, 1);
  }));
test("new branch scans reachable history; branch deletions need no scanner", () =>
  fixture((cwd, git) => {
    const head = git("rev-parse", "HEAD");
    const zero = "0".repeat(40);
    assert.equal(
      run(cwd, ["--push"], `refs/heads/new ${head} refs/heads/new ${zero}\n`)
        .status,
      0,
    );
    assert.equal(
      run(cwd, ["--push"], `(delete) ${zero} refs/heads/old ${head}\n`).status,
      0,
    );
  }));
test("invalid transactions and missing base objects fail closed", () =>
  fixture((cwd, git) => {
    assert.equal(run(cwd, ["--push"], "invalid\n").status, 1);
    const head = git("rev-parse", "HEAD");
    assert.equal(
      run(
        cwd,
        ["--push"],
        `refs/heads/main ${head} refs/heads/main ${"f".repeat(40)}\n`,
      ).status,
      1,
    );
  }));

test("missing scanner blocks a commit", () =>
  fixture((cwd) => {
    const result = spawnSync(process.execPath, [scanner, "--staged"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PATH: "/nonexistent" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Gitleaks is required/u);
  }));

test("range arguments reject options and shell syntax", () =>
  fixture((cwd, git) => {
    const head = git("rev-parse", "HEAD");
    assert.equal(run(cwd, ["--range", "--all", head]).status, 1);
    assert.equal(run(cwd, ["--range", "$(echo unsafe)", head]).status, 1);
  }));

test("new branches exclude known remote history but scan every new commit", () =>
  fixture((cwd, git) => {
    git("remote", "add", "origin", "https://example.invalid/repo.git");
    writeFileSync(path.join(cwd, "old.txt"), `token=${secret}\n`);
    git("add", "old.txt");
    git("commit", "-qm", "existing remote history");
    const base = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", base);
    writeFileSync(path.join(cwd, "clean.txt"), "clean\n");
    git("add", "clean.txt");
    git("commit", "-qm", "new clean commit");
    let head = git("rev-parse", "HEAD");
    const zero = "0".repeat(40);
    assert.equal(
      run(
        cwd,
        ["--push", "origin"],
        `refs/heads/new ${head} refs/heads/new ${zero}\n`,
      ).status,
      0,
    );
    writeFileSync(path.join(cwd, "new.txt"), `token=${secret}\n`);
    git("add", "new.txt");
    git("commit", "-qm", "new synthetic secret");
    head = git("rev-parse", "HEAD");
    assert.equal(
      run(
        cwd,
        ["--push", "origin"],
        `refs/heads/new ${head} refs/heads/new ${zero}\n`,
      ).status,
      1,
    );
  }));
