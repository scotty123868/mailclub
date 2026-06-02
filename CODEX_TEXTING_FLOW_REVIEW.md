# Codex deep review — Mailroom texting flow + sent-message presentation

You are a senior product engineer and product designer doing a DEEP, exhaustive
review of Mailroom. Read the code thoroughly. Trace the conversation state machine
end to end. Do not skim, do not summarize the code back to me. Find real, specific,
actionable improvements with file:line and exact proposed copy.

## What Mailroom is
An iMessage-first service: a user texts a photo to a number, a short conversational
bot collects who it's for plus addresses, and we mail a real paper postcard via Lob.
Modes: friend send, "pen pal" (mail to a matched stranger, anonymous both ways), and
a no-address "claim link" (recipient fills their own address via a link). An iOS app
(React Native / Expo: `src/`, `app/`, `ios/`) shows the user's sent cards. A web card
page renders each sent postcard with a tap/drag-to-flip 3D card and an Apple Maps
route (that page lives in a SEPARATE repo, `mailroom-site/c/index.html`).

The bot is a Supabase Edge Function (Deno/TypeScript):
`supabase/functions/loop-inbound/index.ts` holds the state machine and ALL copy.
Supporting functions: `lob-send-postcard`, `postcard-render-gifs`, `lob-webhook`,
`c-bridge`, `sms-buy-checkout`, `stripe-webhook`, `fire-scheduled-postcards`.
Outbound iMessage is LoopMessage (sandbox tier): `message/send` with `attachments[]`,
`subject`, `effect`, `reply_to_id`.

## Hard constraints (do NOT propose violating these)
- The channel is a bot over iMessage. In-thread bubbles are STATIC: image, GIF, or
  video only. There is NO interactive widget inside the thread. True interactivity
  (tap/drag to flip) can ONLY live on the web card the link opens. Do not propose
  interactive in-thread UI.
- No real mail right now: respect the `MAILROOM_TEST_MODE_NO_LOB` guard everywhere.
- Voice rules, enforced everywhere:
  - NO em dashes. Use commas, periods, or "...".
  - NO all-caps reply REQUIREMENTS. Never tell a user to text in caps. Keywords
    (buy, memories, penpal) match case-insensitively, so reference them lowercase.
  - NO cutesy or buzzword errors. An error says plainly what went wrong and the one
    next step.
  - Lean copy. No "AI feel", no happy talk, no self-congratulation.

## The quality bar (design)
Reference: series.so, a beautiful iMessage-first product. Their presentation is
cinematic, restrained, SF-native, premium, with real iMessage UI fidelity. Hold the
"sent message" experience (the celebration the sender receives, AND the iOS app's
view of a sent card) to that bar.

## Read these deeply
1. `supabase/functions/loop-inbound/index.ts` — the whole state machine. Trace EVERY
   step: idle -> photo intake -> who-is-this-for -> address (friend / claim-link /
   pen-pal) -> message -> send-confirm -> celebration. Plus globals: buy, memories,
   reply-codes, the freeform AI router.
2. Celebration paths: `doMail` (friend), `doMailStranger` (pen pal),
   `doMailReplyToPenPal` (reciprocation), `startClaimLink` / `finishClaimSend` (claim
   link), and `postcard-render-gifs` (the follow-up stills + route map).
3. The iOS app's sent-card / gallery presentation in `src/` and `app/`.

## Find (prioritize P0 -> P3, each with file:line and a concrete fix or exact copy)

### A. Correctness / syntax / state-machine
- Dead-end or stuck states, steps that cannot be exited, stranded drafts.
- `advance_sms_conversation` shallow-merge hazards (stale jsonb keys never cleared).
- Races: claim minted before the photo uploads, double-send, credit refunded twice
  or not at all, cooldown set when no card actually mailed.
- Keyword hijacking: a note that starts with "buy"/"memories" wrongly triggering a
  command instead of being treated as the card's text.
- Any missing `await`, unhandled rejection, or type error.

### B. Conversation flow
- Fastest path to "who is this for" — is every first response tight and directed?
- Edge cases: no photo, multiple photos, non-photo attachment, gibberish, mid-flow
  topic change, "stop", "start over", out-of-credits mid-send.
- Redundancy: anything said twice across bubbles (recipient name, distance, "your
  card").
- Latency: anything blocking the first reply that could be backgrounded.

### C. Language — succinct, clear, high response rate
- For EVERY user-facing string: is it the fewest unambiguous words? Rewrite the weak
  ones with exact proposed copy.
- Errors: specific, honest, one next step, no buzzwords.
- Enforce the voice rules above. Flag any violation with the line.
- CTA clarity: does each prompt make the next action a mindless, obvious choice?

### D. Presentation of the sent message (the magic moment), to the Series bar
- The celebration the sender receives (stamping -> postmark -> photo -> card stills +
  route map -> promise). Is the choreography as beautiful and native as it can be
  given the static-bubble constraint? What is redundant, what is missing?
- The rendered card stills (front/back) and the Apple Maps route image: are they
  gorgeous, postal, on-brand? What would make them feel hand-crafted, not generated?
- The iOS app's sent-card gallery: concrete redesign notes to reach Series-level
  beauty and iOS nativeness (SF type scale, depth, restraint, motion, layout).

## Output
One prioritized list. For each finding:
`[P0|P1|P2|P3] file:line - problem - concrete fix (exact final copy if it is wording)`
Group by the four dimensions A-D. Be exhaustive; this is a deep run, not a skim.
Where you propose copy, give the final text, not a description of it.
