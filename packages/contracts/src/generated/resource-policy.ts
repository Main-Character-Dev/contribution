/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface ResourcePolicy {
  schemaVersion: 1;
  hostLimits: {
    [k: string]: number;
  };
  projectLimits: {
    [k: string]: number;
  };
}
