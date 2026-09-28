# 04-Dan-Counter-Terminal — Counter Staff (Dan, $18 Terminal) — shop tap-to-pay

## Hook
Punch price. Customer taps. Paid.

## Script (60-75s, ~140 words, VO + captions)

[0-5s HOOK] "Punch price. Customer taps. Paid." (Terminal JC4880P443 close-up)
[5-20s SETUP] Terminal speaks 3 backends — we use Self-custody: type Lightning Address, no API key. PN532 NFC + LNURL-pay.
[20-40s SALE] Dan punches 12,000 sats → QR + NFC reader active. Customer taps N424 → GET /api/nfc/scan?p/c → SUN ok → invoice paid, PAID flashes, printer hands receipt.
[40-55s REDEEM vs MFA] Same tap that gates Nostr signing also pays — one tag, two uses. No custodian.
[55-65s BUILD] Guition JC4880P443 ESP32-P4 + PN532 $6 + STL case — flash via thebitcointerminal.com/flash. MIT.
[65-75s CTA] satnam.pub/terminal — clone, flash, take sats this afternoon.

## Storyboard (8 shots, 16:9)

1. 1. Hook: Terminal on counter, 'Punch price. Customer taps. Paid.'
2. 2. Setup: 3 backends tiles, highlight Self-custody LNURL-pay
3. 3. Hardware: JC4880P443 board + PN532 + printer exploded view
4. 4. Sale: Numpad 12000 → QR + NFC active split screen
5. 5. Tap: Customer tag tap close-up, SUN check animation
6. 6. Paid: PAID screen + receipt printing
7. 7. Dual use: Tag tap → sign vs pay icons
8. 8. CTA: GitHub clone + flash

## Captions spec
- Burn-in lower third, 3-beat captions, 7s max per card, satnam gold #c9a86a on dark.
- End card: `satnam.pub/physical-mfa` + QR to docs.
