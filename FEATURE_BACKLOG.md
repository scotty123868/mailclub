# Feature backlog

Stuff we've decided is worth building but isn't on the critical path right now. Newest at top.

---

## "Send a link" — recipient self-serves their address

**The pitch (user-facing copy):**

> No address? No problem. At checkout, choose **"Send a link"** and your recipient fills in their own. You'll get notified when it ships, and they can record a video reaction when it arrives.

**Why this is the killer feature:**

Right now Mailroom hits a wall the first time someone wants to send a card to a friend whose address they don't know. The address-input form gates the entire purchase. TouchNote solved this exact problem in 2014 and it became their primary growth loop — sender invites recipient → recipient enters address + becomes a user → recipient sends their own cards. Viral coefficient > 1.

**Flow sketch:**

1. Send screen → recipient picker → tap **"They'll fill in their address"** option (or default fallback when friend has no address)
2. Sender writes the postcard message as normal, picks a category, hits Send
3. Credits charged immediately (we collect now, ship later)
4. Postcard goes to a **"pending address"** state — `postcard.status = 'awaiting_address'`
5. App generates a short, unguessable claim URL: `https://mailrooms.app/claim/AB7K9XQ` (8-char base32, links to a one-time claim token)
6. Sender picks how to send the link:
   - **iMessage** (most common — Share Sheet on iOS with pre-filled "Hey, I sent you a Mailroom postcard 👇 [link]")
   - **SMS** (Twilio fallback if they want us to send the text on their behalf)
   - **Copy link** (paste anywhere)
7. Recipient taps link → light-weight web claim page (NOT app required):
   - "Scotty sent you a postcard ✉️"
   - Address form: name + line 1 + line 2 + city + state + zip
   - "Where should we send it?" CTA
   - On submit → address saved → trigger fires → Lob ships the card
   - Bonus CTA: "Download Mailroom to send your own" (deferred deep-link to App Store)
8. Sender gets a push notification: "Your card to <recipient> is on its way 📮"
9. **Recipient gets a follow-up flow when the card arrives** (Lob webhook says delivered):
   - Push or SMS: "Your card from Scotty arrived. Record a video reaction?"
   - Tap → opens app (download flow if not installed) → camera → 5-second clip
   - Sender sees the reaction in their MailHistory tab. Boom: feedback loop closed.

**Engineering bits:**

- New `postcards.status` enum value: `awaiting_address`
- New `postcard_claims` table: `id, postcard_id, claim_token, expires_at, claimed_at, claimed_by_address`
- New Edge Function: `claim-postcard/:token` — public endpoint, no auth
- Web claim page: simple static React + form posting to claim-postcard
- Domain: pointing `mailrooms.app/claim/*` at a Vercel-hosted or Supabase-hosted static page
- iMessage share sheet integration: `Share` API in RN
- Push for "card arrived → record reaction": already on the Lob webhook path
- Video reactions: separate feature (storage bucket + upload flow + playback on sender's side)

**Pricing question to decide:**

- Send-a-link mode has a small chance the recipient never claims → we already charged the sender. Refund automatically after 30 days? Keep the credit on file? Either is fine but pick before launch.

**Priority:** P1 — biggest growth lever post-launch. Build after TestFlight beta validates the basic flow works.

---

## (other future ideas go below this line — newest at top)
