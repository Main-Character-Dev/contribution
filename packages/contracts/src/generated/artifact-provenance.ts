/* Generated from canonical JSON Schema. Runtime validation remains required. */

export interface ArtifactProvenance {
  schemaVersion: 1;
  recordMode: "observed" | "fixture";
  artifactId: string;
  repositoryId: string;
  source: {
    commit: string;
    tree: string;
    inputDigest: string;
    configurationId: string;
    configurationDigest: string;
    adapterId: string;
    adapterVersion: string;
    policyRevision: string;
  };
  build: {
    hostId: string;
    attemptId: string;
    preparedAt: string;
    macOSVersion: string;
    macOSBuild: string;
    xcodeVersion: string;
    xcodeBuild: string;
    engineVersion: string;
  };
  artifact: {
    sha256: string;
    bytes: number;
    format: "ipa" | "signed_app_archive";
  };
  app: {
    bundleId: string;
    teamId: string;
    applicationIdentifier: string;
    marketingVersion: string;
    buildVersion: string;
  };
  signing: {
    mode: "development" | "ad_hoc";
    signatureVerified: true;
    provisioningVerified: true;
    entitlementsDigest: string;
    provisioningProfileDigest: string;
    /**
     * @minItems 1
     */
    eligibleDeviceRefs: [string, ...string[]];
    verifiedAt: string;
  };
  deviceAcceptance: "not_established_by_preparation";
  evidenceRefs: string[];
}
