# 03-Carol-Group-Steward — Group Steward (Carol, 3-of-5 DAO) — revoke & re-provision

## Hook
Members come and go. Your keys shouldn't.

## Script (60-75s, ~140 words, VO + captions)

[0-5s HOOK] "Members come and go. Your keys shouldn't."
[5-20s PROBLEM] 5-person DAO, one member leaves with a tag — still can sign if 3-of-5.
[20-40s SOLUTION — Revoke] Carol → FROSTR Member → Revoke → Wipe tag (ResetCard) → nfc_cards state=reset, Version++ → same UID new K0-K4.
[40-55s RE-PROVISION] Give spare blank UID to new member → provision same ID logic but new UID Version → bind to that member's share. Old tag now fails SUN (ctr vs new lastCtr).
[55-70s PAYOFF] Threshold stays 3-of-5, no re-ceremony for others, no LNbits DB of keys — deterministic ID = PRF(IssuerKey, UID) survives Version bump.

## Storyboard (8 shots, 16:9)

1. 1. Hook: 5 avatars around vault, one highlighted leaving
2. 2. Problem: Old tag still valid threat
3. 3. Revoke: Dashboard Revoke → Wipe progress → state=reset
4. 4. Re-provision: New blank tag tapped, same ID new Version
5. 5. Verify: Old tag tap → 'Replay rejected ctr <= last'
6. 6. New member tap → '✓ CTR new > last'
7. 7. Payoff: 3-of-5 stays, no full re-setup

## Captions spec
- Burn-in lower third, 3-beat captions, 7s max per card, satnam gold #c9a86a on dark.
- End card: `satnam.pub/physical-mfa` + QR to docs.
