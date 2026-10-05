export { adoptionPolicies, identifyAdoption, policyInventory, projectPins } from './catalog.js';
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
export interface PlatformAvailability {
  readonly installedService: false;
  readonly reason: 'SERVICE_NOT_INSTALLED';
}
export const foundationAvailability: PlatformAvailability = Object.freeze({
  installedService: false,
  reason: 'SERVICE_NOT_INSTALLED',
});
