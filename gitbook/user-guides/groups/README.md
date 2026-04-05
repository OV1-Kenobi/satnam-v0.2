# Group Management

A Satnam **Group** is a federation of Principals — people, AI agents, or both — governed by a FROST-managed shared keypair. Groups replace the "family" concept from v1 and provide a general-purpose structure for any organization that needs shared digital identity, shared funds, and auditable authority chains.

---

## What Is a Group?

A group in Satnam is defined by three things:

1. **A shared keypair** — generated via FROST Distributed Key Generation (DKG). No single member holds the full group private key. The group keypair is the group's sovereign identity on Nostr.
2. **A role hierarchy** — four roles (Guardian, Steward, Adult, Offspring) that define capabilities through NIP-26 delegation events, not a database table.
3. **A spending policy** — controls who can authorize payments from the group wallet, and at what thresholds.

Groups exist entirely on Nostr. The group's public key, member roles, and delegation events are stored on Nostr relays. No group data lives in Satnam's Supabase database.

---

## Role Hierarchy

Satnam's role system is modeled on trust estate structures: each role maps to a trust estate concept.

```
Guardian (Trust Protector)
  └── Steward (Trustee)
        ├── Adult (Mature Beneficiary)
        │     ├── Adult (human member)
        │     └── Adult (autonomous NIP-SA agent)
        └── Offspring (Immature Beneficiary)
              ├── Offspring (human member)
              └── Offspring (supervised NIP-SA agent)
```

### Guardian — Trust Protector

The Guardian is the highest-authority role. Every group has exactly one Guardian, though the Guardian can hold multiple FROST shares across different groups.

- Initiates the FROST DKG ceremony to create the group keypair
- Holds FROST share #1
- Signs NIP-26 delegation events for all other roles
- Is the only role that can initiate FROST key ceremonies
- Can publish and revoke NIP-CA attestations
- Controls the group's allowed Cashu mint list

### Steward — Trustee

The operational authority. Groups can have multiple Stewards.

- Holds FROST share #2 (and up to share #n for additional Stewards)
- Co-signs group transactions above the single-signature threshold
- Can add/remove members at the Adult or Offspring level
- Can modify spend policies within Guardian-set limits
- Can create agents within their span of control

### Adult — Mature Beneficiary

A full-capability member with spending authority within policy limits.

- Can spend Lightning and Cashu within policy
- Can create agents within their span of control
- Can submit DVM marketplace jobs
- Can register skills via NIP-SKL
- Can participate in NFC Proof of Life ceremonies

### Offspring — Immature Beneficiary

A restricted member or supervised agent.

- Cannot spend independently — requires Guardian or Steward approval
- Cannot submit DVM jobs independently — requires approval
- Can participate in NFC Proof of Life ceremonies with Guardian co-signature
- Supervised NIP-SA agents hold this role

---

## Trust Estate Framing

The role names reflect how Satnam models real-world organizational structures:

| Satnam Role | Trust Estate Equivalent | Typical Use Case |
|---|---|---|
| Guardian | Trust Protector | Family head, organization founder, principal custodian |
| Steward | Trustee | CFO, operations lead, authorized co-signer |
| Adult | Mature Beneficiary | Team member, adult family member, autonomous agent |
| Offspring | Immature Beneficiary | Junior staff, minor, supervised AI agent |

This framing works equally well for:
- **Families** — parents as Guardians/Stewards, children as Offspring, grown children as Adults
- **Businesses** — founders/executives as Guardians, managers as Stewards, employees as Adults
- **Agent teams** — human operators as Guardians/Stewards, AI agents as Adults/Offspring based on autonomy level

---

## Use Cases

### Family Financial Sovereignty

A family uses a Satnam group to manage shared Bitcoin savings. The parents are Guardian and Steward (holding FROST shares), so no single parent can unilaterally move large amounts. Children start as Offspring and are promoted to Adult when they reach adulthood. NFC Proof of Life ceremonies provide regular evidence of member presence.

### Business Multi-Signature Authorization

A small company creates a group with the CFO as Guardian, the CEO as Steward, and department heads as Adults. Group funds require at least two keyholders to sign. Every authorization action is recorded as a NIP-26 delegation event on Nostr — a permanent, auditable record.

### AI Agent Team

A developer is the Guardian. They deploy multiple AI agents — a research agent and a coding agent — as Adults within the group. Each agent has a spend policy set by the Steward. Agents can submit DVM marketplace jobs and pay for compute automatically within their policy limits. The Guardian can revoke any agent's delegation at any time.

---

## How Groups Differ from v1 ("Families")

| v1 Behavior | v2 Behavior |
|---|---|
| "Family" terminology | Generic "Group" — works for any organization type |
| Full group nsec stored encrypted in Supabase | FROST DKG — no single party ever holds the group nsec |
| Shamir Secret Sharing for recovery | FROST share rotation — group identity preserved |
| Role assignments in Supabase database table | NIP-26 delegation events on Nostr relays |
| JWT-gated role checks | NIP-26 delegation graph traversal |

---

## Related Pages

- [Creating a Group](./creating-a-group.md) — Step-by-step Guardian flow and DKG ceremony
- [Managing Roles](./managing-roles.md) — NIP-26 delegation, capability matrix, and revocation
- [What Is FROST?](../../overview/glossary.md#f) — Glossary entry for threshold signatures
- [Agent Management](../agents/README.md) — Deploying agents within a group
