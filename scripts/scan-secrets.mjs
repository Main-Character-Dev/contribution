#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GITLEAKS_")),
);
function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", env });
  if (result.status !== 0)
    throw new Error("Cannot resolve the outgoing Git history.");
  return result.stdout.trim();
}
function scan(logOptions, staged = false) {
  const args = ["git", "--redact=100", "--no-banner"];
  if (staged) args.push("--pre-commit", "--staged");
  else args.push(`--log-opts=${logOptions}`);
  const result = spawnSync("gitleaks", args, { stdio: "inherit", env });
  if (result.error)
    throw new Error(
      "Gitleaks is required. Install it with brew install gitleaks.",
    );
  if (result.status !== 0)
    throw new Error(
      "Secret scanning failed. Remove exposed secrets and rotate real credentials before retrying.",
    );
}
try {
  const [mode, base, head] = process.argv.slice(2);
  if (mode === "--staged") scan("", true);
  else if (mode === "--history") scan("--all");
  else if (mode === "--range") {
    if (
      !/^[a-f0-9]{40,64}$/u.test(base ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(head ?? "")
    )
      throw new Error("Expected base and head commit IDs.");
    scan(`${base}..${head}`);
  } else if (mode === "--push") {
    const transactions = readFileSync(0, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const line of transactions) {
      const fields = line.trim().split(/\s+/u);
      if (fields.length !== 4) throw new Error("Invalid pre-push transaction.");
      const [, local, , remote] = fields;
      if (
        !/^[a-f0-9]{40,64}$/u.test(local) ||
        !/^[a-f0-9]{40,64}$/u.test(remote)
      )
        throw new Error("Invalid pre-push commit IDs.");
      if (/^0+$/u.test(local)) continue;
      git(["cat-file", "-e", `${local}^{commit}`]);
      if (/^0+$/u.test(remote)) {
        const remoteName = base;
        if (remoteName) {
          if (
            !/^[A-Za-z0-9_.-]+$/u.test(remoteName) ||
            !git(["remote"]).split("\n").includes(remoteName)
          )
            throw new Error("Unknown push remote.");
          scan(`${local} --not --remotes=${remoteName}`);
        } else scan(local);
      } else {
        git(["cat-file", "-e", `${remote}^{commit}`]);
        scan(`${remote}..${local}`);
      }
    }
  } else
    throw new Error(
      "Usage: node scripts/scan-secrets.mjs --staged | --history | --push | --range BASE HEAD",
    );
} catch (error) {
  console.error(`[secrets] ${error.message}`);
  process.exitCode = 1;
}
