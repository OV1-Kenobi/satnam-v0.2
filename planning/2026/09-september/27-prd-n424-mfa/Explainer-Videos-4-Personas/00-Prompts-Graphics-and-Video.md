# Graphics & Video Prompts — N424 MFA 4 Personas

> Use for Midjourney / DALL·E / Stable Diffusion (graphics) + Runway / Pika / Luma (video). 16:9, dark vault palette: #0a0a0f bg, gold #c9a86a, teal #2dd4bf, red #ef4444 for fail.

## Global Style

**Graphics prompt base:** `isometric 3D, dark vault interior, soft studio lighting, minimal UI, satnam gold #c9a86a accents, 8k, --ar 16:9 --style raw`

**Video prompt base:** `smooth camera, shallow depth of field, product close-up, 24fps, no text wobble, loopable 2s, --motion 4`

---

## 01 Alice — Solo Sovereign

**Graphic 1 — Hero N424:** `macro photo NTAG424 card on brass keyring, dark slate, gold foil SUN chip visible, shallow DOF, isometric, satnam vault background`
**Graphic 2 — Provision ring:** `phone screen progress ring 75%, NDEF write lnurlw://bridge…/scan?p=..&c=.. , lawalletio style, dark UI, gold ring`
**Graphic 3 — PIN:** `PIN pad 6 digits on phone, caption "PIN never leaves phone", vault icon, dark mode`

**Video 01:** `close-up hand tapping N424 on phone NFC, progress ring fills clockwise, cut to "✓ SUN ctr 1 >0" green flash, smooth`

## 02 Bob — Family 2-of-3

**Graphic 1 — Family vault:** `3 N424 cards fanned on oak table, 2-of-3 FROSTR diagram, family avatars, warm light`
**Graphic 2 — Binding:** `phone tap tag → share_id ↔ card_id line, database row animation, teal success`

**Video 02:** `two hands tapping two different N424s sequential, partial sig particles combine into one Schnorr sig, gold burst`

## 03 Carol — DAO Revoke

**Graphic 1 — Revoke:** `dashboard "Revoke Member" red button, tag state=reset, Version++ arrow`
**Graphic 2 — Replay rejected:** `NFC tap with red X "Replay rejected ctr <= lastCtr" , counter 5 vs last 7`

**Video 03:** `old tag tap fails red, new blank tag tap succeeds green, version bump counter animation`

## 04 Dan — Terminal

**Graphic 1 — Terminal exploded:** `Guition JC4880P443 ESP32-P4 board + PN532 NFC + CSN-A2 printer exploded, STL case translucent, spec callouts`
**Graphic 2 — Sale:** `Terminal screen QR + NFC active split, numpad 12000 sats, PAID flash`

**Video 04:** `hand punches 12000 on numpad, customer taps N424, PAID + receipt prints, 10s loop`

---

## Negative prompts

`no LNbits logo, no custodian, no text errors, no extra fingers, no blurry QR`

## Deliverables per persona

- 3 stills (hero, provision/sale, PIN/backup)
- 1 60-75s voiceover video (script in *-Script-Storyboard.md`) — VO: calm, peer, Field Register for Dan, full natural for Alice/Bob/Carol
- End card: `satnam.pub/physical-mfa` + QR (use `qrcode-generator` consistent style)
