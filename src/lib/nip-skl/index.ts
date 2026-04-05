/**
 * NIP-SKL barrel export — Skill Registry
 * All public types and functions for the NIP-SKL skill registry module.
 */

// Types
export type {
  SkillManifest,
  GuardianAttestation,
  VerificationTier,
  SkillVersionLog,
  RuntimeConstraint,
  SkillRegistryCacheEntry,
  RuntimeGateResult,
  NostrEvent,
  AttestationVerificationResult,
  SkillRevocationEvent,
} from "./types";

export { VerificationTierLabels } from "./types";

// Manifest fetching and parsing
export {
  fetchSkillManifest,
  validateManifest,
  parseManifestContent,
  computeManifestHash,
  verifyManifestHash,
} from "./manifest";

// Registry cache
export { SkillRegistryCache, getSkillRegistry } from "./registry";

// Runtime gate (safety-critical)
export { verifySkillExecution } from "./runtime-gate";
export type { RuntimeGateOptions } from "./runtime-gate";

// Attestation verification
export {
  verifyGuardianAttestation,
  checkAttestationTier,
  parseTierFromLabel,
  getMinimumCrossPlatformTier,
  tierMeetsMinimum,
} from "./attestation-verifier";

// Skill registration & lifecycle
export {
  buildSkillManifest,
  buildSkillAttestation,
  buildSkillVersionLog,
  buildSkillRevocation,
  SkillManager,
} from "./skill-registration";

export type {
  SkillManifestParams,
  SkillAttestationParams,
  SkillVersionLogParams,
  SkillRegistrationParams,
  SkillVersionUpdateParams,
  SkillWithAttestations,
} from "./skill-registration";
