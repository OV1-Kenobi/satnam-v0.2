# NIP-SKL: Skill Registry

NIP-SKL (Skill Registry) defines how agent capabilities are declared, attested, versioned, and gate-checked at runtime. A skill in NIP-SKL is a formally declared unit of agent capability with a cryptographic hash, attestation tier, and version history.

Before any agent executes a skill, the NIP-SKL runtime gate runs five checks. Execution is blocked if any check fails.

---

## Skill Manifest (kind:33400)

The Skill Manifest is the canonical declaration of a skill. It is a parameterized replaceable event (NIP-33) identified by a `d` tag.

### Tags

```json
[
  ["d", "research-v2"],
  ["name", "Market Research"],
  ["version", "2.0.0"],
  ["description", "Researches market data across public sources"],
  ["manifest_hash", "<sha256_of_canonical_payload>"],
  ["capability", "web_search"],
  ["capability", "data_extraction"],
  ["capability", "summarization"],
  ["t", "agent-skill"],
  ["t", "research"],
  ["expiry", "<unix_timestamp>"]
]
```

| Tag | Description |
|---|---|
| `d` | Skill scope ID — the unique identifier for this skill (used in NIP-AC envelopes) |
| `name` | Human-readable skill name |
| `version` | Semantic version (major.minor.patch) |
| `description` | Natural-language description of what this skill does |
| `manifest_hash` | SHA-256 of the canonical manifest payload (content + tags, normalized) — used in NIP-AC `scope_constraints_hash` |
| `capability` | An atomic capability this skill provides (repeatable) |
| `t` | Hashtag for discovery and filtering |
| `expiry` | Unix timestamp after which this skill manifest version is no longer valid |

### Content

The content field contains additional structured metadata:

```json
{
  "input_schema": {
    "query": "string",
    "max_sources": "number",
    "output_format": "markdown|json"
  },
  "output_schema": {
    "summary": "string",
    "sources": "string[]",
    "confidence": "number"
  },
  "resource_limits": {
    "max_tokens": 50000,
    "max_duration_seconds": 300,
    "max_cost_msats": 10000
  }
}
```

---

## Skill Attestation (kind:1985, NIP-32 Labels)

Attestations are NIP-32 label events (`kind:1985`) that vouch for a skill manifest:

```json
{
  "kind": 1985,
  "pubkey": "<guardian_pubkey>",
  "tags": [
    ["L", "skill"],
    ["l", "skill/verified", "skill"],
    ["l", "tier3", "skill"],
    ["e", "<skill_manifest_event_id>"],
    ["p", "<skill_author_pubkey>"]
  ],
  "content": "Guardian attestation: market research skill verified for production use."
}
```

| Tag | Description |
|---|---|
| `L` | Namespace — always `"skill"` for NIP-SKL attestations |
| `l` | Label value within namespace — `"skill/verified"` and tier |
| `e` | Reference to the skill manifest event being attested |
| `p` | Pubkey of the skill author |

---

## Attestation Tiers

| Tier | Label | Issued By | Meaning |
|---|---|---|---|
| `tier1` | `skill/self` | Skill author (self) | Self-declaration — no external validation |
| `tier2` | `skill/peer` | Peer Principal | Another registered user has reviewed and vouches for the skill |
| `tier3` | `skill/guardian` | Guardian | A Group Guardian has reviewed and attested the skill for use in their group |
| `tier4` | `skill/oracle` | Oracle (NIP-CA issuer) | An external oracle authority has formally certified the skill |

Most production skills require `tier3` (guardian-attested) or `tier4` (oracle-verified). A skill with only `tier1` (self-declared) cannot be used in Credit Envelopes above the Agent's minimum-trust spend threshold.

---

## Skill Version Log (kind:33401)

The Skill Version Log tracks the history of a skill manifest:

```json
{
  "kind": 33401,
  "pubkey": "<skill_author_pubkey>",
  "tags": [
    ["d", "research-v2-log"],
    ["skill", "<skill_scope_id>"],
    ["version", "2.0.0"],
    ["previousVersion", "1.3.2"],
    ["changeType", "major"],
    ["changelog", "Rewrote data extraction engine, breaking API change"],
    ["revokedAt", ""]
  ],
  "content": ""
}
```

| Tag | Description |
|---|---|
| `d` | Version log identifier |
| `skill` | Scope ID of the skill being versioned |
| `version` | New version number |
| `previousVersion` | Previous version number |
| `changeType` | `major` \| `minor` \| `patch` |
| `changelog` | Human-readable change description |
| `revokedAt` | Unix timestamp if this version has been revoked (empty string if active) |

Agents must reject execution of any skill version listed with a non-empty `revokedAt` value.

---

## Runtime Gate (5 Checks)

Before any agent executes a skill, `verifySkillExecution()` runs five sequential checks. Execution is blocked if any check fails.

```typescript
interface RuntimeGateResult {
  manifestExists: boolean;        // Check 1
  guardianAttestationValid: boolean; // Check 2
  noRevocation: boolean;          // Check 3
  versionPinMatches: boolean;     // Check 4
  constraintsSatisfied: boolean;  // Check 5
}

function verifySkillExecution(
  skillScopeId: string,
  agentPubkey: string,
  requiredAttestation: AttestationTier
): RuntimeGateResult { /* ... */ }
```

### Check 1 — Manifest Exists

Verifies that a `kind:33400` event with the given `d` tag exists on relay and the local manifest cache. If the manifest cannot be found, execution is blocked.

### Check 2 — Guardian Attestation Valid

Verifies that a valid `kind:1985` attestation at or above the required tier exists for this manifest. The attestation must:
- Reference the correct manifest event ID
- Have a signature from a known Guardian pubkey (resolved from the group's delegation graph)
- Not have expired

### Check 3 — No Revocation

Verifies that the `kind:33401` version log does not contain a `revokedAt` value for the current version. Also checks for any `kind:5` deletion requests against the manifest event.

### Check 4 — Version Pin Matches

The agent profile (`kind:39200`) specifies which skill scope IDs are enabled via `enabled_skills` tags. If the agent's profile pins a specific version, the executing version must match exactly. This prevents agents from silently upgrading to untested skill versions.

### Check 5 — Constraints Satisfied

Verifies that the runtime context satisfies the skill's resource limits and input schema constraints:
- Input data matches the declared input schema
- Available spend budget is within `resource_limits.max_cost_msats`
- No policy violations against the agent's `AgentSpendPolicy`

---

## verifySkillExecution() Explained

```typescript
async function verifySkillExecution(
  skillScopeId: string,
  agentPubkey: string,
  requiredAttestation: AttestationTier
): Promise<RuntimeGateResult> {
  // Check 1: Fetch manifest from cache or relay
  const manifest = await skillCache.get(skillScopeId)
    ?? await relay.getSkillManifest(skillScopeId);
  if (!manifest) return fail({ manifestExists: false });

  // Check 2: Verify attestation
  const attestations = await relay.getAttestations(manifest.id);
  const validAttestation = attestations.find(a =>
    a.tier >= requiredAttestation &&
    delegationGraph.isGuardian(a.pubkey) &&
    !isExpired(a)
  );
  if (!validAttestation) return fail({ guardianAttestationValid: false });

  // Check 3: Check revocation log
  const versionLog = await relay.getVersionLog(skillScopeId);
  if (versionLog?.revokedAt) return fail({ noRevocation: false });

  // Check 4: Version pin
  const agentProfile = await relay.getAgentProfile(agentPubkey);
  const pinnedSkill = agentProfile.enabledSkills.find(s => s.id === skillScopeId);
  if (pinnedSkill?.version && pinnedSkill.version !== manifest.version) {
    return fail({ versionPinMatches: false });
  }

  // Check 5: Resource constraints
  const constraintsOk = checkConstraints(manifest.resourceLimits, currentContext);
  if (!constraintsOk) return fail({ constraintsSatisfied: false });

  return {
    manifestExists: true,
    guardianAttestationValid: true,
    noRevocation: true,
    versionPinMatches: true,
    constraintsSatisfied: true,
  };
}
```

A skill that fails any gate check is logged (without key material — security invariant S11) and the agent workflow is paused for Governor review.
