# Tutorials

Step-by-step walkthroughs for common Satnam v2 workflows. Each tutorial starts from the beginning and walks you through a complete task, explaining what is happening at each step.

---

## Prerequisites

Before starting any tutorial, you should have:
- Satnam v2 installed as a PWA (visit [satnam.pub](https://satnam.pub) on Android Chrome or desktop browser)
- An identity created or imported (your nsec stored in the OPFS Vault)
- Vault unlocked (WebAuthn biometric or passphrase)

If you have not yet created an identity, see [Getting Started](../user-guides/getting-started/README.md).

---

## Tutorial List

### [Create Your First Group](first-group.md)

**Time:** 15–20 minutes  
**Difficulty:** Intermediate

Walk through the complete group creation flow: create a FROST-managed group, add members with different roles, assign roles via NIP-26 delegation, and co-sign your first group event. Covers the FROST DKG ceremony and role assignment.

**You will learn:**
- How FROST threshold signing works in practice
- How to add Guardians, Stewards, Adults, and Offspring
- How NIP-26 delegation events grant role capabilities
- How to verify a group co-signature

---

### [Deploy Your First Agent](deploy-agent.md)

**Time:** 20–30 minutes  
**Difficulty:** Intermediate to Advanced

Create an autonomous agent, configure its spend policy, register skills from the NIP-SKL registry, and submit a DVM job. Covers the full NIP Triumvirate (NIP-SA + NIP-AC + NIP-SKL).

**You will learn:**
- How to publish an agent profile (kind:39200)
- How to set spend policies that constrain agent autonomy
- How to register and attest skills
- How to submit a NIP-90 DVM job and track it through the credit lifecycle

---

### [Setting Up NFC Cards](nfc-setup.md)

**Time:** 10–15 minutes  
**Difficulty:** Beginner  
**Hardware required:** NTAG424 DNA card or TapSigner + Android device (Chrome)

Provision an NTAG424 NFC card with your identity keys, write the AES keys to your OPFS Vault, and perform your first tap verification. Includes iOS fallback setup for devices without Web NFC.

**You will learn:**
- How NTAG424 cards store AES-128 keys
- How CMAC verification works client-side
- How to set a PIN for card-triggered operations
- How to test the Proof of Life ceremony state machine
