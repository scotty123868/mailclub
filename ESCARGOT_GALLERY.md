# Escargot Inspiration Gallery

**Date:** 2026-05-11
**Source:** 8 App Store / in-app screenshots from `escargot` (competitor. "Mail a card in 60 seconds")
**Status:** Analysis only. No code changes. Read this, then decide what's worth implementing.

---

## TL;DR

Escargot is faster, louder, more viral. Mailroom is deeper, warmer, more coherent. Steal escargot's onboarding mechanics, viral mechanics, and a few discrete UI patterns. Do NOT copy the chaotic visual identity, profanity-forward card art, or phone-verification onboarding.

**High-leverage steal list (top 5):**
1. **Viral mechanic** with iMessage-styled green bubble + "Every friend = a free card. Math we love." copy. We have nothing like this. Highest revenue + activation impact of anything in the gallery.
2. **Speed promise above the fold**. "Mail a card in 60 seconds." Quantifies the value prop. We currently lead with brand poetry.
3. **First-card welcome offer with a countdown**. converts curious downloaders into senders within 24 hours.
4. **Map-as-locked-reward**. gate the map view behind sending your first card. Right now ours is unlocked by default and is a vanity surface.
5. **Birthday-as-task**. surface upcoming friend birthdays as a "Todo" list on the home screen with one-tap Send.

**Do NOT steal:**
- Profanity-forward card art ("Fuck it We ball", "you are dead to me"). Off-brand for our warmer, more sincere voice. Different ICP.
- Phone-number verification onboarding. Apple Sign-In is lower friction in our codebase, doesn't require SMS spend, doesn't lock people out who use VOIP numbers.
- "Get free cards" mystery pill at the top of escargot's home. Hides the incentive behind an opaque CTA. bad UX.
- "Shop" as a primary tab. We don't sell ancillary products. Premature nav.

---

## Mailroom is already winning on these (DON'T regress)

Before stealing anything, recognize where we're already better. Don't sand these off.

| Surface | Mailroom | Escargot |
|---|---|---|
| **Brand coherence** | Physical-mail identity threaded through every screen (stamps, postmarks, paper, serif). Reads as a single product. | Pop-culture pastiche. Cursive logo, Y2K stickers, neon greens, vintage postcard frames. vibes shift screen-to-screen. |
| **Send-a-link privacy** | Magic-link send to a phone-only recipient who fills in their address privately. Recipient address never exposed to sender. | No equivalent. You must either have the address or use contacts. |
| **Constellation insights** | "Warmest friend," "newest connection," "sleeping 60+ days". derived from real send/receive data. | Generic "Close Circle" face row. No relational depth. |
| **Routes from real sends** | Map tab derives routes from actual postcard `fromCity → toCity` pairs. Pseudo-mileage. | Map exists but appears decorative pre-send. |
| **Card-idea prompts on home** | "Send me the photo from tonight," "Send me your favorite place in your city". these are interaction prompts. | None. Their home pushes referral + first-card offer. |

These are real product moats. The gallery below tells you what to add, not what to throw away.

---

## Proposed changes (ranked by impact)

### 1. Viral referral with iMessage-styled share. **HIGH impact**

**Inspiration:** Screenshot 3 + 4. "Every friend = a free card. Math we love. / You get one. They get one." with a green iMessage-bubble share button "Invite your entire group chat", and a contact-access card "Get your friends on here / Allow contact access to invite them. You'll get a free card, and we'll remind you of their birthday."

**Before (Mailroom):** No referral mechanic. New users get 5 free credits at signup, then they buy packs. There's no growth loop. Word-of-mouth requires a user to manually screenshot the app.

**After (proposed):** First-launch second-screen (or post-first-send screen): "Send your group chat. They get a free card. So do you." Big share button that opens iMessage with a pre-filled message: "[Name] sent you a postcard via Mailroom. Try it free → [link]." The green-bubble visual is genius because it looks native to iMessage, which is where 80% of these will be shared.

**Why it matters:** This is the single highest-leverage change. Real-mail-app virality is "look what I sent". both parties win. We already have a magic-link mechanism for send-a-link; this is structurally similar. Reuse the claim-URL infrastructure.

**Friction:** New API surface (referral codes, attribution, credit grant on claim). Medium engineering. Worth it.

**Open question:** Do we credit on link tap, or on signup completion? Probably signup. link tap is too cheap to monetize.

---

### 2. "Mail a card in 60 seconds" speed positioning. **HIGH impact**

**Inspiration:** Screenshot 1. escargot leads their App Store screenshot with this exact phrase, in 60pt serif.

**Before (Mailroom):** Our App Store leads with brand/identity. The current MVP_PLAN positions us as "Snapchat through mail." Internally clear; externally vague.

**After (proposed):**
- App Store screenshot 1 headline: **"A real postcard, in about a minute."**
- First-launch welcome modal subtitle changes from "Real postcards, sent by you, to the people who matter. Tell us who's writing." to **"Pick a photo. Add a note. We print and mail it. Takes about a minute."**

**Why it matters:** Converts. App Store viewers spend less than 7 seconds on the first screenshot. "60 seconds" is a wager. they want to test it. Vague brand poetry doesn't earn the download.

**Friction:** Zero. Pure copy change. Ship today.

**Caveat:** Our actual send is longer than 60s if they fill in an address from scratch. Say "about a minute" instead. defensible against the worst case.

---

### 3. First-card welcome offer with countdown. **HIGH impact**

**Inspiration:** Screenshot 5. Home screen shows a bright green card: "WELCOME OFFER 11h 59m left / Your first card is on us / Join Escargot membership and get a bonus card your first month / Claim offer | Later"

**Before (Mailroom):** New users get 5 free credits at signup. There's an `OnboardingFreeCreditsBanner` on `my-card.tsx`. No urgency. Many users will sit on the credits indefinitely.

**After (proposed):** Above-the-fold home banner that says **"Send your first card before midnight. We'll throw in a bonus."** With a 24h countdown timer driven from the signup timestamp. When it expires, replace with: "Want another nudge? Tap to set a Send Day reminder."

**Why it matters:** Activation. The number-one reason new users don't send is choice paralysis. A deadline forces a decision. The "bonus" can be 1 extra credit. psychologically valuable, financially cheap (61¢ at Lob).

**Friction:** Small. Countdown component, expiry stored in `currentUser.signupAt`. The bonus credit grant happens server-side on first-send. Re-uses existing credit system.

**Risk:** Don't let the timer feel scammy. Make the copy warm: "First card on us, before tomorrow." Not "ACT NOW or lose your free credit forever."

---

### 4. Map view gated on first send. **MEDIUM-HIGH impact**

**Inspiration:** Screenshot 5. Escargot's home map has a gray overlay over the empty map: "Unlock map tracking by sending your first card."

**Before (Mailroom):** Map tab is always accessible. New users with zero sends see an empty map, which makes the feature feel broken or pointless.

**After (proposed):** When `postcards.length === 0`, render the map dimmed (40% opacity) with a centered chip: **"Send your first card to light up the map."** Tapping the chip routes to `/send`. After first send, full color + "Your routes" appears.

**Why it matters:** Turns a vanity surface into a quest reward. Map empty-state currently signals "nothing happening here." Locked state signals "this is what you get if you send."

**Friction:** Small. Conditional render in `map.tsx`. Style tweaks only.

---

### 5. Friend birthdays as a Todo list on home. **MEDIUM-HIGH impact**

**Inspiration:** Screenshot 5 + 9. "Todo 8" badge with task list ("Maya Chen / Birthday in 8 days · Sun · Oct 12 / Send card | Dismiss"). Birthdays become tasks. Inbox-zero for relationships.

**Before (Mailroom):** Birthdays are a new field we just added in signup, but they're not surfaced anywhere on home. Constellation has "sleeping friends" but that's relational decay, not calendar events.

**After (proposed):** Above-the-fold on `my-card.tsx`: a horizontal scroll of upcoming birthdays in the next 30 days, each with friend avatar, "Birthday in 8 days" subtitle, and inline "Send card" + "Dismiss" buttons. Reuse the existing `IllustratedAvatar` and `PrimaryButton`.

**Why it matters:** Birthdays are the second-most-common reason people send physical cards (after move-aways and condolences, neither of which we want to lead with). This converts the birthday field from passive metadata into the app's main retention loop.

**Friction:** Medium. Requires:
- Friend records to have a `birthday` field (currently only the current user has one. extend `Friend` type)
- Birthday-extraction logic + "next occurrence" math
- Component for the horizontal scroll

**Future:** When we wire contact-access permission, auto-populate friend birthdays from iOS Contacts (escargot's pattern). Quid-pro-quo: grant access, get +1 credit + we remind you of their birthday.

---

### 6. Contact access for +1 credit. **MEDIUM impact**

**Inspiration:** Screenshot 3 + 4. "Allow contact access to invite them. You'll get a free card, and we'll remind you of their birthday."

**Before (Mailroom):** No contact access ever. Users manually add friends via name + city + state. Friction is real.

**After (proposed):** Optional permission gate during onboarding (or first time tapping "Add friend"): **"Connect your contacts. Get a free postcard. We'll find friends already on Mailroom, and remind you when their birthdays are coming up."** Match by phone number on backend. Privacy disclosure: "We never message your contacts. Hashes only."

**Why it matters:** Friend list density is the single best predictor of send frequency in physical-mail products. Manual entry caps the friend graph at ~3 people for the median user. Contact access pushes it to ~15.

**Friction:** Medium-high. New permission. New backend RPC for phone-hash matching. Privacy review.

**Risk:** Permission rejections cluster around iOS contact-access prompts. If we ask too early (cold), reject rate is 60%+. Time it right: after first successful send, when the user has positive sentiment.

---

### 7. Stamp-frame photo card preview. **MEDIUM impact**

**Inspiration:** Screenshot 8. Escargot wraps the user's photo in a vintage-stamp frame (scalloped edges, green border, postage marks). Premium feel, more "card" than "snapshot."

**Before (Mailroom):** Our `PostcardFrontPreview` is a flat photo with a thin border. Looks like an Instagram crop.

**After (proposed):** Add an optional "Stamp frame" toggle in the send flow. Below the FlipCard, a horizontal scroll of 4-6 frame styles (stamp/scalloped, polaroid white border, washi tape, vintage postcard). Tapping picks the frame; the front face re-renders. The Lob print version uses the same frame so it actually ships that way.

**Why it matters:** Differentiates from "photo with a caption" (which is just iMessage). Frames make it a card. Frames are also a free-to-cheap upsell opportunity in the membership product.

**Friction:** Medium. SVG frame components + composition layer in `PostcardFrontPreview`. Render-test in Lob's print pipeline to make sure bleed/cut is correct.

**Open question:** Is this a paid feature (membership unlock) or a free differentiator? Probably free at first, paid for the premium pack (foil, hand-stamped, etc).

---

### 8. "Make someone's day" CTA copy. **LOW-MEDIUM impact**

**Inspiration:** Screenshot 1. Escargot's primary CTA on their App Store welcome is a black pill that says "Make someone's day." Not "Get started" or "Sign up."

**Before (Mailroom):** Our welcome CTA is "Continue" (and "Start writing" if no backend). Functional, not emotional.

**After (proposed):**
- Welcome sheet primary button → **"Send your first card"** (replaces "Continue / Start writing")
- Send screen primary button → **"Send postcard"** (already correct, keep)
- Failed-send retry → "Try again. they're waiting"

**Why it matters:** Copy carries the brand. Generic verbs feel like a SaaS form. Emotional verbs feel like the product. We're already mostly here on the send screen; just fix the welcome CTA.

**Friction:** Zero. String change.

---

### 9. Delivery transparency block. **MEDIUM impact**

**Inspiration:** Screenshot 7. "Delivered how you want it." Big iPhone mockup shows Delivery Details with the recipient avatar + name, a map preview with the actual delivery address, and a footer: "We'll print and mail it tomorrow. Free delivery via USPS First Class Mail. Takes about a week to arrive."

**Before (Mailroom):** Our success modal says "Heading to [name] via USPS First Class Mail. It should arrive in about 1–2 weeks." Decent, but the send screen itself doesn't preview the delivery story before send.

**After (proposed):** Between the recipient picker and the Send button on `send.tsx`, render a small "Delivery preview" row:
```
📮  We'll print Tuesday • Mailed Wednesday • Arrives ~Oct 18
```
Real dates derived from the current date + Lob's quoted SLA. Sets expectations, reduces "where's my card?" support tickets.

**Why it matters:** Trust. Physical mail is slower than digital. users need to know the timeline BEFORE they hit Send so the wait doesn't feel broken.

**Friction:** Small. Date math + a `<DeliveryRow>` component.

---

### 10. Dual-typography system: script logo + serif emotional. **LOW impact, identity polish**

**Inspiration:** All escargot screenshots. "escargot" wordmark is in a swooping cursive script. Headlines ("Confirm your number to continue", "Never forget an important date ever again") are in tall serif. Body copy is sans.

**Before (Mailroom):** We already have a script font for the brand wordmark (`fonts.script`, used on the welcome sheet). Headlines use `fonts.serifSemi`. Body uses `fonts.serif`. The system is consistent.

**After (proposed):** Audit instances where headlines drop to sans (a few buttons, the bottom-tab labels). Push everything emotional into serif. Push everything utilitarian (timestamps, counts, status badges) into the sans. We're already 80% there.

**Friction:** Low. Style audit + a few `fontFamily` swaps.

**Caveat:** Make sure serif renders cleanly at small sizes on Android. Test on a low-DPI device.

---

## What I'd hold off on

- **Phone verification onboarding.** Lower friction, sure, but adds Twilio cost ($0.0075/SMS × N attempts), creates lockout for users on Google Voice, and we already have Apple Sign-In which is faster and free. Stick with Apple Sign-In + optional email/password.
- **Profanity-forward card art.** Different brand. Our identity is warmer ("real postcards to the people who matter"). leaning into edgy humor would break the trust we're building on the my-card identity surface.
- **"Get free cards" mystery pill at the top of home.** It hides the offer behind an opaque CTA. We already show the credits balance + Buy. Don't bury the lede.
- **"Shop" tab.** We're not selling stamps, packs of paper, etc. Adding a Shop tab when we have nothing to sell sends the wrong signal.
- **Membership product.** Escargot is pushing a membership ("Join Escargot membership and get a bonus card your first month"). We have packs. Until we know the LTV math, don't fork into membership. it dilutes the buy-packs muscle memory.

---

## Open questions for product

1. **Birthday source-of-truth:** When (and if) we add contact-access matching, do friend birthdays come from (a) our own contacts permission, (b) the friend filling them in via the "Ask" magic-link, or (c) the friend's own Mailroom profile? Tradeoffs: privacy vs density vs freshness.
2. **Referral attribution:** Credit-on-tap or credit-on-signup? Cheap attacks against credit-on-tap. Credit-on-signup is harder to abuse but slower feedback.
3. **Welcome-offer expiry:** 24h is escargot's number. Is that right for us? 24h might pressure new users into a low-quality send. 72h might be saner.
4. **Map gate vs map decorative:** Right now Map is a "fun to scroll" surface. Locking it raises the bar. does the locked state convert better, or does it feel punitive? Worth A/B if we have the volume.
5. **Stamp-frame as default:** Should the photo cover auto-frame with a default stamp, or stay raw? Auto-framing is more "wow" on first send. Raw is more "your photo, real."

---

## Suggested ship order

If product wants to act on this, here's the order that maximizes activation/revenue with the least engineering:

1. **Today (copy only):** Speed positioning ("60 seconds"), CTA copy ("Make someone's day" / "Send your first card"). Zero engineering.
2. **This week:** First-card welcome offer with 24h countdown. Reuses credits system. ~1 day.
3. **This week:** Map-gate on first send. Style + conditional. ~half day.
4. **Next sprint:** Birthday Todo on home. Requires friend-birthday data model extension + UI. ~2 days.
5. **Next sprint:** Viral referral with iMessage share. Reuses claim-URL system. ~3 days.
6. **Sprint after:** Contact-access matching + stamp-frame photo previews. Bigger lifts.

That gets us through the high-leverage half of this list inside a month, in priority order.

---

*Generated 2026-05-11 from 8 escargot App Store + in-app screenshots. Update as new competitor screens come in.*
