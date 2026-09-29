# 02-Bob-Family-Guardian — Family Guardian (Bob) — 2-of-3 household vault

## Hook
One key = one rug pull. Three tags = none.

## Script (60-75s, ~140 words, VO + captions)

[0-5s HOOK] "One key = one rug pull. Three tags = none."
[5-20s PROBLEM] Family sats in one nsec — Bob alone can rug. Need 2-of-3 but no LNbits, no custodian.
[20-45s SOLUTION — FROSTR + Tags] Create 2-of-3 FROSTR → 3 shares. Bind each share ↔ tag tap (Bob, partner, kid). Each share wrapped by that tag+PIN.
[45-60s USE] To send 50k sats, need 2 taps — Bob taps+PIN, partner taps+PIN → partials combine → final. One tag alone fails.
[60-75s BACKUP & REVOKE] Each tag backed up .bak.json+QR in separate drawers. Kid loses tag? Wipe → Version+1 → provision spare, re-bind share — family still 2-of-3. No LNbits.

## Storyboard (8 shots, 16:9)

1. 1. Hook: 3 N424 fanned, text 'One key = one rug pull'
2. 2. Problem: Single nsec key, red 'Bob alone can sign'
3. 3. Solution: FROSTR 2-of-3 ceremomy animation, 3 shares
4. 4. Binding: Tap tag per participant, share_id ↔ card_id rows
5. 5. Use: Two phones tapping sequential, '2 taps → 1 signature'
6. 6. Fail: One tag tap alone → 'Need 1 more'
7. 7. Backup: 3 drawers, 3 QRs
8. 8. Revoke: Wipe → Version+1 → spare tag re-bound

## Captions spec
- Burn-in lower third, 3-beat captions, 7s max per card, satnam gold #c9a86a on dark.
- End card: `satnam.pub/physical-mfa` + QR to docs.
