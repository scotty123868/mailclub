/**
 * addressAutocomplete — US address suggestions via Google Places API (New).
 *
 * v0.7.0.15: swapped off Nominatim. Nominatim returned coarse town-level
 * matches without street numbers (the "5209 Dorset Ave Chevy Chase MD"
 * → "Dorset Avenue, Bethesda MD" bug). Google Places has street-level
 * coverage everywhere a USPS-deliverable address exists, which is exactly
 * what we need for Lob to validate at print time.
 *
 * Two-call flow (cheaper than fetching details for every suggestion):
 *   1. `fetchAddressSuggestions(query)` → Autocomplete (New). Cheap,
 *      returns suggestions with placeId + display label. Used to populate
 *      the dropdown.
 *   2. `fetchPlaceDetails(placeId)` → Place Details (New). One billed
 *      call per actual selection. Returns structured line1/city/state/zip.
 *
 * Session tokens (`X-Goog-Session-Token`) tie multiple autocomplete
 * requests to a single billable session that ends with a getPlace call.
 * Significant cost saver at scale — without sessions, each keystroke
 * could bill independently.
 *
 * API key lives in app.json → extra.googlePlacesApiKey. The key is
 * RESTRICTED in Google Cloud Console to:
 *   - iOS bundle: com.mailrooms.app
 *   - APIs: Places API (New), Geocoding API
 * So a key leak from the bundle can only be used for these APIs from
 * THIS bundle.
 *
 * Pricing reality (Google's $200/mo free credit):
 *   - Autocomplete (per request): $5/1000
 *   - Place Details (per request): $5/1000
 *   - $200 credit → ~40k autocomplete requests OR ~20k Details/Autocomplete
 *     session pairs per month free. Plenty of room for the first year.
 */

import Constants from "expo-constants";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_DETAILS_BASE = "https://places.googleapis.com/v1/places";

function getApiKey(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    googlePlacesApiKey?: string;
  };
  return extra.googlePlacesApiKey ?? "";
}

export type AddressSuggestion = {
  /** Display label shown in the dropdown row. */
  label: string;
  /** Google Place ID — pass to fetchPlaceDetails to resolve full address. */
  placeId: string;
  /** Best-effort split text. Always available, useful if details fetch fails. */
  mainText?: string;
  secondaryText?: string;
  /** Filled by fetchPlaceDetails. Empty when this came from autocomplete. */
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};

/**
 * Session tokens reduce billing. Hold one per "type-to-pick" cycle.
 * Resets after a successful fetchPlaceDetails or after a few minutes
 * of inactivity. The AddressFields component manages this — pass the
 * token along on each autocomplete call and getPlace call so Google
 * counts them as one session.
 */
export function newSessionToken(): string {
  // RFC4122-ish — Google accepts any opaque string as a session token.
  // Math.random() is fine here; it's not security-sensitive.
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Fetch up to 5 US address suggestions for a query string. Each
 * suggestion has a placeId — call fetchPlaceDetails(placeId) to resolve
 * the structured address fields when the user picks one.
 *
 * Returns [] silently on any failure (network, rate limit, missing key).
 */
export async function fetchAddressSuggestions(
  query: string,
  opts: { signal?: AbortSignal; sessionToken?: string } = {},
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const res = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      signal: opts.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // v0.7.0.17: Google API key is restricted to iOS bundle
        // com.mailrooms.app. When you call from JS fetch (not the native
        // SDK), Google checks this header against the key's allowlist.
        // Without it the request is REQUEST_DENIED and no suggestions
        // surface — which is exactly the "autocomplete isn't working"
        // bug a user reported. Hardcoded to match the actual bundle ID
        // so a stale Constants.expoConfig doesn't break the request.
        "X-Ios-Bundle-Identifier": "com.mailrooms.app",
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["us"],
        languageCode: "en",
        // Bias toward complete street-level results. "street_address"
        // includes building-numbered addresses; "premise" includes
        // named buildings + apartments.
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
        ...(opts.sessionToken ? { sessionToken: opts.sessionToken } : {}),
      }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn("[addressAutocomplete] Google Places", res.status);
      return [];
    }
    const data = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
        };
      }>;
    };
    return (data.suggestions ?? [])
      .map((s): AddressSuggestion | null => {
        const p = s.placePrediction;
        if (!p?.placeId) return null;
        const label = p.text?.text ?? "";
        if (!label) return null;
        return {
          label,
          placeId: p.placeId,
          mainText: p.structuredFormat?.mainText?.text,
          secondaryText: p.structuredFormat?.secondaryText?.text,
          line1: "",
          line2: "",
          city: "",
          state: "",
          zip: "",
        };
      })
      .filter((s): s is AddressSuggestion => s !== null);
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    // eslint-disable-next-line no-console
    console.warn("[addressAutocomplete] fetch failed", err?.message ?? err);
    return [];
  }
}

/**
 * Resolve a Google placeId into structured address fields. One billed
 * call — pair it with the same sessionToken used for the autocomplete
 * calls so Google counts the whole interaction as one session.
 */
export async function fetchPlaceDetails(
  placeId: string,
  opts: { signal?: AbortSignal; sessionToken?: string } = {},
): Promise<AddressSuggestion | null> {
  if (!placeId) return null;
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const url = new URL(`${PLACE_DETAILS_BASE}/${placeId}`);
  if (opts.sessionToken) url.searchParams.set("sessionToken", opts.sessionToken);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: opts.signal,
      headers: {
        "X-Goog-Api-Key": apiKey,
        // Match the iOS bundle restriction on the API key — see
        // fetchAddressSuggestions for the full rationale.
        "X-Ios-Bundle-Identifier": "com.mailrooms.app",
        "X-Goog-FieldMask":
          "id,formattedAddress,addressComponents,displayName",
      },
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn("[addressAutocomplete] place details", res.status);
      return null;
    }
    const data = (await res.json()) as {
      formattedAddress?: string;
      addressComponents?: Array<{
        longText?: string;
        shortText?: string;
        types?: string[];
      }>;
    };
    return parsePlaceDetails(placeId, data);
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    // eslint-disable-next-line no-console
    console.warn("[addressAutocomplete] details fetch failed", err?.message ?? err);
    return null;
  }
}

function parsePlaceDetails(
  placeId: string,
  data: {
    formattedAddress?: string;
    addressComponents?: Array<{
      longText?: string;
      shortText?: string;
      types?: string[];
    }>;
  },
): AddressSuggestion | null {
  const components = data.addressComponents ?? [];
  const find = (type: string, short = false): string => {
    const c = components.find((c) => (c.types ?? []).includes(type));
    if (!c) return "";
    return (short ? c.shortText : c.longText) ?? c.longText ?? c.shortText ?? "";
  };
  const streetNumber = find("street_number");
  const route = find("route");
  const subpremise = find("subpremise"); // e.g. "Apt 4B"
  const locality = find("locality") || find("sublocality_level_1") || find("postal_town");
  const adminLevel1 = find("administrative_area_level_1", true /* short */);
  const postalCode = find("postal_code");

  const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  if (!line1 || !locality || !adminLevel1) return null;

  return {
    label: data.formattedAddress ?? `${line1}, ${locality}, ${adminLevel1} ${postalCode}`,
    placeId,
    line1,
    line2: subpremise,
    city: locality,
    state: adminLevel1,
    zip: postalCode,
  };
}
