export { adoptionPolicies, identifyAdoption, policyInventory, projectPins } from './catalog.js';
export { reportingPatch, reportingEnvironment } from './reporting.js';
export { leaseBridgePatch } from './lease-bridge.js';
export type { AdoptionPolicy } from './catalog.js';
// Adapters describe project policy. The shared engine owns execution.
export interface ProjectRuntimeSelection {
  readonly executable: string;
  readonly version: string;
  readonly policyRevision: string;
}
export interface RepositoryAdapter {
  readonly id: string;
  readonly repositoryId: string;
  readonly projectRuntime: ProjectRuntimeSelection;
}
