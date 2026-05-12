# Google Maps API key — setup for the Mailroom map

Mailroom's Map tab uses `react-native-maps` rendering real US geography styled as an aged-parchment vintage map. On iOS, Apple Maps doesn't accept custom style JSON, so the actual styled map requires **Google Maps** as the provider. This doc walks you through getting a free Google Maps API key and wiring it into the app.

> **Cost:** Google Maps Mobile SDK gives **$200 of credit per month free**. For the tier we'll be in (TestFlight beta with <100 users), this is effectively free — you'd need ~30,000 map opens per month to start paying.
>
> **If you skip this:** the app falls back to Apple Maps `mutedStandard` + a sepia tint overlay. It works and looks decent, but you can't hide the modern road grid or label labels, so it won't match the Indiana Jones aesthetic. **Get the Google key for the real thing.**

---

## 1. Create / pick a Google Cloud project (5 min)

1. Go to <https://console.cloud.google.com>
2. Sign in with any Google account. (Can be your personal account; doesn't have to be a special one.)
3. Top bar → project dropdown → **New Project**
4. Name: `Mailroom`. Leave organization blank.
5. Click **Create**.

---

## 2. Enable the Maps SDK for iOS (2 min)

1. With the Mailroom project selected, go to <https://console.cloud.google.com/apis/library>
2. Search **"Maps SDK for iOS"** and select it
3. Click **Enable**
4. Wait ~30 seconds for it to activate

---

## 3. Set up billing (required, but you stay in the free tier)

Google Cloud requires a payment method on file even for the free tier. You won't actually be charged unless you exceed the $200/month credit, which a beta won't.

1. Sidebar → **Billing**
2. Link a billing account (or create one if you don't have one). Use a card you trust.
3. Set a **budget alert** at $1 to catch any surprises: Billing → Budgets & alerts → Create → "Mailroom alert" → $1 → notify by email.

---

## 4. Create the API key (3 min)

1. Sidebar → **APIs & Services → Credentials**
2. **+ Create Credentials → API key**
3. A modal pops up with your new key. **Copy it.** Looks like `AIzaSyB...`
4. Click **Restrict Key** (important — unrestricted keys get billed if anyone scrapes them).
5. Configure restrictions:
   - **Application restrictions:** iOS apps → Add `com.mailroom.app` (the Mailroom bundle ID)
   - **API restrictions:** Restrict key → select **Maps SDK for iOS** only
6. **Save**.

---

## 5. Paste the key into Mailroom (1 min)

Open `app.json` in this repo. Find this section:

```json
"ios": {
  ...
  "config": {
    "googleMapsApiKey": ""
  },
  ...
}
```

Paste your API key inside the empty quotes:

```json
"config": {
  "googleMapsApiKey": "AIzaSyB..."
}
```

Save the file.

---

## 6. Regenerate the iOS native project (2 min)

```bash
cd /Users/scottylefkowitz/Downloads/mailclub-app
npx expo prebuild --clean
```

This re-runs prebuild with the new plugin config, which:
- Adds Google Maps SDK to the `Podfile`
- Adds your key to the iOS `Info.plist` (specifically `GMSApiKey`)
- Runs `pod install`

If prebuild errors out about Google Maps, double-check that:
- The key is set in `app.json` (no quotes around it being mismatched)
- `"react-native-maps"` is in the `plugins` array (it should already be)

---

## 7. Build + run on sim (3-5 min)

```bash
# In the iOS simulator
npx expo run:ios

# Or via EAS for a release build
eas build --platform ios --profile production
```

The first launch with Google Maps takes ~5 seconds extra because the SDK has to authenticate against your key. After that, it caches.

---

## 8. Verify it's working

Open the Map tab in the app. You should see:

- **Real US coastline + state borders** (Apple Maps with mutedStandard wouldn't show state borders this crisply)
- **Sepia/parchment colors** — cream land, deep tan ocean
- **No roads or POI labels** — clean vintage feel
- **Red dashed routes** connecting your cities
- **Custom pin markers** with paper-pin styling + serif uppercase city names
- **Vintage compass rose + MAILROOM cartouche** beneath the map

If you see modern Apple Maps colors (green parks, blue roads, white background), the Google key isn't being picked up. Check:
1. `app.json` → `ios.config.googleMapsApiKey` has the actual key
2. You ran `npx expo prebuild --clean` after pasting the key
3. The pod install succeeded (look at the prebuild output)

---

## Troubleshooting

### "The API key is not valid" warning in the map

- Make sure the key is restricted to `com.mailroom.app` exactly (not `com.mailclub.app` from the old bundle ID)
- Make sure **Maps SDK for iOS** is enabled in Google Cloud, not just Maps JavaScript API

### Map shows but no roads/borders disappear with the style

- Verify `provider={PROVIDER_GOOGLE}` is being used. On Apple Maps, the custom style is ignored.
- Open `src/components/MapPanel.tsx` and confirm `HAS_GOOGLE` is true at runtime — add a `console.log(HAS_GOOGLE)` temporarily.

### Map appears blank / grey

- API key is missing or restricted to wrong bundle ID
- Or Maps SDK for iOS not enabled in Cloud Console
- Check Xcode console for `GMS` errors

### Billing alert went off

- Almost certainly because the key was unrestricted and got scraped. Revoke immediately:
  - Cloud Console → Credentials → click your key → Disable → confirm
  - Create a new key with strict iOS bundle ID restriction this time
- If you exceeded $1 of usage in a beta, something's off — contact Google billing support, they typically refund small accidental charges.

---

## Cost reference (for the curious)

- Apple SDK calls: **$0.00 per call**
- Google Maps Mobile SDK: **$7 per 1,000 map opens** above the free tier
- Free tier: **$200/month** ≈ 28,571 map opens/month free
- For a 100-user TestFlight beta with each user opening the map 10×/day: ~30,000 opens/month — right at the boundary, still effectively free.
- Public launch at 1,000 daily active users averaging 5 map opens: ~150,000/month = $850/month. **This is when you'd switch to Mapbox** (better pricing at scale).

---

## Why not just use Apple Maps?

Three reasons:
1. **No custom style JSON.** Apple's MapKit doesn't accept Google-style customizations on iOS. The only Apple-side options are `mapType` (standard/satellite/mutedStandard/etc.) and tinted overlays.
2. **Can't fully hide modern features.** Even with `mutedStandard` and `pointOfInterestFilter`, Apple Maps will show road grids, neighborhood names, and city labels. Hiding these is essential for the vintage aesthetic.
3. **Apple's POI labels are baked into the tile rendering.** A sepia tint overlay covers everything, including the things we *do* want to see (state borders, the coastline).

Google Maps gives us a clean canvas: hide all modern features, paint everything sepia, add our routes + custom markers on top.

---

## What about Mapbox? Or MapLibre?

Both are reasonable for v2 if Mailroom outgrows the Google free tier:

- **Mapbox** — better pricing at scale (~$0.50 per 1,000 map loads at 100k+/month), more powerful custom styles (Studio editor)
- **MapLibre** (open-source fork of Mapbox) — fully free, self-hostable, but more setup

For v1 beta, Google is the path of least resistance.
