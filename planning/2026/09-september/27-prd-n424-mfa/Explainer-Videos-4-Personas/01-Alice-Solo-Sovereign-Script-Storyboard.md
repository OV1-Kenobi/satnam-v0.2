# 01-Alice-Solo-Sovereign — Solo Sovereign (Alice) — one tag for my.satnam.pub

## Hook
Your phone can be hacked. Your tag can't.

## Script (60-75s, ~140 words, VO + captions)

[0-5s HOOK] "Your phone can be hacked. Your tag can't." (close-up N424 on keys)
[5-20s PROBLEM] Alice keeps her Nostr ID on phone Vault. One tap without PIN = anyone can sign. No backup = lose phone lose ID.
[20-40s SOLUTION — Loading] Tap blank N424 → Derive Issuer→K0-K4 → write lnurlw://bridge…/scan?p=&c= → set 6-digit PIN (never leaves phone) → test tap+PIN signs kind:1. CTR 1 ok.
[40-55s BACKUP] Tap Back up → PIN → AES-GCM .bak.json + QR. Print, drawer. Lose tag? Restore to new $1 sticker, same ID Version.
[55-70s PAYOFF] Now every signing needs tap+PIN. SUN counter + CMAC stops replays. Solo hardening: 2-of-2 FROSTR — phone share + tag share. Lose one, still safe. satnam.pub/physical-mfa

## Storyboard (8 shots, 16:9)

1. 1. Hook: N424 on keyring, phone blurred behind, text 'Your phone can be hacked. Your tag can't.'
2. 2. Problem: Vault nsec on phone screen, red 'Anyone with phone = can sign'
3. 3. Loading beat 1: Phone 'Check blank' → UID 04:.. green
4. 4. Loading beat 2: Progress ring writing K0-K4, p/c non-zero verification
5. 5. Loading beat 3: PIN pad 4-8 digits, 'PIN never leaves phone' caption
6. 6. Test: Tap+PIN → '✓ SUN ctr 1 > 0, CMAC ok, kind:1 signed'
7. 7. Backup: Back up sheet → .bak.json + QR printing animation
8. 8. Payoff: Solo vault 2-of-2 diagram, phone+tag, final CTA

## Captions spec
- Burn-in lower third, 3-beat captions, 7s max per card, satnam gold #c9a86a on dark.
- End card: `satnam.pub/physical-mfa` + QR to docs.
