# Mailroom bot — full copy gallery + branches

Every scripted message the bot can send, organized by flow, with tighter
rewrites. Source: `supabase/functions/loop-inbound/index.ts` +
`lob-webhook/index.ts`. Voice goal: a friend who runs a tiny mail shop.
Succinct, warm, no wasted words, no chatbot filler.

Legend: **Now** = current copy · **Tighter** = suggested · ✓ = already good.

---

## 0. Global commands (work any time)

- **"cancel" / "stop" / "restart"** → `Cancelled.` ✓
- **"buy" / "buy 5/10/25"** → checkout link, or the menu:
  - **Now:** `BUY 5 ($5/4), BUY 10 ($10/10), or BUY 25 ($25/30). Just BUY = 10-pack.`
  - **Tighter:** `Top up: 5 cards $5 · 10 cards $10 · 25 cards $25. Which?`
- **"memories"** → last 3 cards. Empty: `No postcards yet. Send a photo to start. 📮` ✓
- **"reply ABC123"** (QR on a card) → starts a write-back (see §6).

---

## 1. First contact (texts something, no photo)

- **No account yet:**
  - **Now:** `📮 Welcome to Mailroom` / `A magical mail club. Real paper. By text.\n\nText us a photo to send your first postcard, on us.` ✓
- **Has cards:** `You have 3 cards left. Text a photo to start a new one.` ✓
- **Out of cards:**
  - **Now:** `Out of cards. BUY 5, 10, or 25 to top up.`
  - **Tighter:** `Out of cards. Text "buy" to top up.`

---

## 2. Photo intake (the start of every card)

1. ❤️ tapback on the photo (instant)
2. typing dots
3. **Ack** — `📮 Got it.`  ✓  (first-timers + returning, one clean beat)
4. **The fork** (see §3)

If the upload fails: `Lost the photo somewhere on the conveyor. Send it again?` ✓

**Mid-card new photo** (you already have a card going):
- **Now:** `You've got a card in progress. Start over with this new photo? Yes, or no to keep going.` ✓
- on yes → fresh start · on no → `Okay, keeping your card in progress. Reply to the last step above to keep going.` ✓

---

## 3. Who's this for? (friend ↔ pen pal fork)

- **First-timer:** `Who's this card for?\n\nTell me a name, or say "penpal" to be matched with someone new. First one's on us.` ✓
- **Returning:** `Who's this one for?\n\nTell me a name, or say "penpal" for a new match.` ✓
- **Didn't understand:** `Tell me a friend's name, or say "penpal" to be matched with someone new.` ✓
- **Not a name:** `That doesn't look like a name. Who's the card for?` ✓

---

## 4. FRIEND flow

### 4a. Address
- After a name (no saved address): `Great. What's a good address for Sarah?` ✓
- **Saved in rolodex:**
  - **Now:** `Found Sarah in Denver, CO (861 Humboldt St). Send there? Or give me a different address.` ✓
- Bad parse: `Didn't catch an address. Try: "123 Main St, Naples FL 34101"` ✓
- LLM concern: `<concern> Send the right one?` ✓
- **Missing ZIP** (now auto-filled by Lob; this only shows if Lob can't match): `Almost there. I just need the ZIP. Resend it like:\n861 Humboldt St, Denver CO <ZIP>` ✓

### 4b. Confirm the address
- **Now:** `Mailing to:\n   Sarah\n   861 Humboldt St\n   Denver, CO 80218\n\nGood?`
- **Note:** elsewhere it's `Look right?` and `Does that look right?` — **pick one.** Suggest `Look right?` everywhere (clearest for an address).
- No: `No problem. Send me the correct address?` ✓
- Unclear: `Does that look right? Or just send the correct address.` → align to `Look right? Or send the correct address.`

### 4c. Note
- Returning to a known friend: `Last time, you wrote Sarah (Mar '26): "..."\n\nWant a few ideas to start? Just say "ideas", or go ahead and write your own.` ✓
- First note: `Want to add a note? Just type it (up to 240 chars), or say "skip" to mail only the photo.` ✓
- Empty: `What should the card say?` ✓
- Echo after note: `Got it. "<note>"` ✓
- Skipped: `Got it. No note, just the photo.` ✓
- **Ideas** (opt-in, AI): `💡 Some ideas` / `1. ...\n\n2. ...\n\n3. ...` then `Pick 1, 2, or 3, or just write your own.` ✓

### 4d. First-timer only — your address (so friends could send back)
- **Now:** `Last step. What's your full mailing address? We keep it private (only your city shows on the postcard) so Sarah can mail one back to you.\n\nFormat: street, city, state, ZIP.`
- **Tighter:** `Last thing — your mailing address, so Sarah can write back. Stays private; only your city shows on the card.\nstreet, city, state, ZIP.`
- Confirm: `Your address (where pen pals write back):\n<addr>\n\nLook right? Or send a different one.` ✓

### 4e. Review + send
- **Now:** `CHICAGO ──→ DENVER\n\n   To: Sarah\n\n   "<note>"\n\nSEND, schedule, or CANCEL.`
- **Tighter (kill the keywords):** `CHICAGO ──→ DENVER\n   To: Sarah\n   "<note>"\n\nSend it? Or name a day to mail it later.`
- Heavy note variant: `...This one feels meaningful. SEND when you're ready, or CANCEL.` → `...This one feels meaningful. Send it whenever you're ready.`
- Reprompt: `Just tell me to send it, name a day to mail it later ("June 15", "in 3 days"), or say never mind.` ✓ (this one's already natural — make the review bubble match it)

### 4f. Celebration (immediate send)
1. `📮 Stamping...`
2. `📮 Postmarked` / `POSTMARKED · MAY 30, 2026\nCHICAGO STATION\n\nOff to Sarah.` ✓
3. gallery: your photo + card flip + route map, caption `Naples, FL · 1,100 mi` (routeCaption) ✓
4. `Lands in Sarah's mailbox Jun 3.\n<link>` ✓ (+ low-balance nudge)

---

## 5. PEN PAL flow

- Picked penpal: `🪶 Pen pal mode` / `We'll match you with someone in the pool. You won't see their address. They won't see yours.\n\nWhat should your card say? (Up to 240 chars, or say "skip"...)` ✓
- Note → your address (`§4d` copy) → confirm.
- Review: `DENVER ──→ ✦\n\n   To: a pen pal in the pool\n   "<note>"\n\nSEND, schedule, or CANCEL.` → same keyword cleanup as 4e.
- Can't schedule: `Pen pal cards go out in the next Sunday drop, so they can't be scheduled. Just tell me to send it, or say never mind.` ✓
- **Sunday Drop celebration:**
  1. `🪶 Joining the pool...`
  2. `🪶 In Sunday's drop` / `You're the 14th card in this week's pool.` ✓
  3. `We match + mail every Sunday at noon. Yours flies Sunday, Jun 7.` ✓
  4. photo, caption `· To somewhere ·` ✓
  5. `When they write back, you'll know.\n<link>` ✓
- **Empty pool** (cold start): `Couldn't find a match right now. Try SEND again in a sec.` → **Tighter:** `No one in the pool right now. I'll hold your card and match you the moment someone joins.` (and keep the draft, don't dead-end)

---

## 6. REPLY flow (someone writes you back)

- **QR scan / "reply ABC123":** `💌 Writing back` / `Got it. We'll write Sarah in Denver back.\n\nSend me the photo you want on the card.` ✓
- Bad code: `Couldn't find a card with code ABC123. Double-check the code on the back of the postcard.` ✓
- **Active reply** (you texted a photo and have an unreciprocated pen pal): `📬 Pen pal reply waiting` (offers to write them back)
- Loop-closed celebration: `💌 Loop closed` / `POSTMARKED · ...\nDENVER STATION\n\nOff to Sarah.` ✓ → gallery → `Lands in Sarah's mailbox Jun 3.`
- **The reveal** (pushed to the ORIGINAL sender the moment you reply): `💌 A reply is on its way` / `Someone in Denver just wrote you back. Their card is heading to your mailbox now.` ✓

---

## 7. After it mails (Lob status → in-thread)

- Scheduled card hits the mail: `📮 Just mailed` / `Your scheduled card just hit the mail. Arrives Jun 7.` ✓
- In transit: `🚚 In transit` / `Your card is moving. Should land in a few days.` ✓
- **Delivered:** `📬 It landed` / `It just landed in Sarah's mailbox. 🎉` + card + route map ✓

---

## 8. Errors (postal-annex voice — keep, but de-keyword)

- `Hmm, the mailroom's locked. Try again in a minute?` ✓
- `That photo flew the coop. Send another?` ✓
- `Lost the photo somewhere in the sorting bin. Send it again?` ✓
- `Hmm, the recipient drawer's stuck. Try once more?` ✓
- `The press is jammed (<err>). Credit refunded. Just tell me to send it again.` ✓
- `We lost the thread on that card. Text a fresh photo to start over.` ✓
- Out of cards at send: `Out of cards. BUY 5, 10, or 25 to top up, then SEND.` → **Tighter:** `Out of cards. Text "buy" to top up, then tell me to send it.`

---

## Top consistency fixes (the "no wasted words / no SMS feel" pass)

1. **Kill leftover SHOUTING keywords.** `SEND` / `CANCEL` still appear in the
   review + out-of-cards bubbles, even though the rest of the flow moved to
   natural language ("just tell me to send it"). Replace every `SEND`/`CANCEL`
   with `send it` / `never mind`.
2. **One confirm phrase.** Addresses use `Good?`, `Look right?`, and `Does that
   look right?` interchangeably. Pick `Look right?` everywhere.
3. **Tighten the address ask** (§4d) — it's the longest bubble in the flow.
4. **Empty-pool message** should reassure + hold the card, not say "try again."
5. **"buy"** — present as lowercase natural ("text buy to top up"), not `BUY`.

---

## Where AI could genuinely help (without the per-message cost)

The flow is deterministic on purpose — it's free + instant. Add AI only where
it removes friction, on the *miss* path, so the happy path stays $0.

1. **Intent router on the fallback (highest value).** Today, anything the
   regex doesn't recognize gets a generic re-prompt ("tell me a name or
   penpal"). Instead, when input doesn't match a branch, send it to gpt-4o-mini
   once to classify intent: change the photo / cancel / who did I write last /
   resend to the same person / a question. Only fires on misses, so it's a
   fraction of a cent and makes the bot feel like it *understands* instead of
   barking keywords. This is the direct answer to "why does it feel like old
   SMS" — keep fast keywords, add a smart catch-all.
2. **Photo-aware note ideas.** The "ideas" feature already ghostwrites notes.
   Feed the actual photo to a vision model so suggestions reference what's in
   it ("That sunset over the water..."). One call, opt-in.
3. **"Send another to Mom."** Natural recipient recall — LLM maps a casual
   phrase to a saved rolodex contact, skips the name+address steps.
4. **Tone nudges.** After a note, offer one tap: "warmer / funnier / shorter."
   One call, opt-in.
5. **Already shipped, keep:** sentiment-aware send effect (heavy notes slow
   down), Lob CASS address correction, regex-first parsing.

Recommended next: **#1 (intent router on misses).** Biggest feel upgrade,
near-zero cost, doesn't touch the instant happy path.
