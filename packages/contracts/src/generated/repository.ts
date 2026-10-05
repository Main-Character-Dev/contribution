/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface Repository {
  schemaVersion: 1;
  repositoryId: string;
  name: string;
  integration: {
    branch: string;
    adapter: string;
  };
  publication: {
    remote: string | null;
    branch: string | null;
    pullRequestBase: string | null;
    mode: "explicit";
  };
  validation: {
    profile: "local-development" | "standard";
    gate: "enabled" | "inactive";
    adapter: string;
    builtins: string[];
    checks: {
      id: string;
      /**
       * @minItems 1
       */
      profiles: ["local-development" | "standard", ...("local-development" | "standard")[]];
      /**
       * @minItems 1
       */
      argv: [string, ...string[]];
      /**
       * A relative directory resolved and validated within the intended repository context.
       */
      cwd: string;
      timeoutSeconds: number;
      reuse: "never" | "adapter";
    }[];
  };
  runtime: {
    node: "repository";
    packageManager: "repository";
  };
}
