/**
 * addressAutocomplete — debounced US address suggestions powered by
 * OpenStreetMap&apos;s Nominatim public API.
 *
 * Why Nominatim:
 *   - Free, no API key, no quota signup
 *   - Returns structured address components (house_number, road, city,
 *     state, postcode, country) so we can map directly to AddressDraft
 *   - Covers US addresses well; not as deep as Google Places for
 *     building numbers in dense urban areas, but more than enough for
 *     the v0.7 ship
 *
 * Why not Google Places:
 *   - Needs an API key + billing setup in Google Cloud Console
 *   - Costs money per request (free tier is generous but real)
 *   - We can upgrade to Places in v0.7.1 if Nominatim coverage proves
 *     insufficient. The autocomplete UI surface stays the same; only
 *     this service file swaps.
 *
 * Per Nominatim&apos;s usage policy:
 *   https://operations.osmfoundation.org/policies/nominatim/
 *   - Max 1 req/sec (we debounce 350ms = well under)
 *   - Include a User-Agent identifying our app
 *   - No bulk geocoding (we&apos;re user-typed, single-keystroke requests)
 *
 * Failure modes — network error, rate limit, malformed response — all
 * return an empty array silently. The user just sees no suggestions and
 * falls back to typing the address themselves.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

// Build a polite User-Agent so Nominatim&apos;s ops team can identify
// Mailroom traffic. Their policy requires this for non-browser clients.
const USER_AGENT = "Mailroom/0.7 (https://mailrooms.app; postcard mailing app)";

export type AddressSuggestion = {
  /** Full display string — shown in the dropdown row. */
  label: string;
  /** Structured fields ready to fill the AddressDraft form. */
  line1: string;
  city: string;
  state: string; // 2-letter code (when we can derive it)
  zip: string;
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
};

type NominatimRow = {
  display_name?: string;
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    cycleway?: string;
    footway?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    "ISO3166-2-lvl4"?: string;
    postcode?: string;
    country_code?: string;
  };
};

function toSuggestion(row: NominatimRow): AddressSuggestion | null {
  const a = row.address ?? {};
  // Build line1 from house_number + road. If road is missing, fall
  // back to pedestrian/cycleway/footway (Nominatim sometimes returns
  // those for non-street addresses).
  const road = a.road ?? a.pedestrian ?? a.cycleway ?? a.footway ?? "";
  const line1 = [a.house_number, road].filter(Boolean).join(" ").trim();
  if (!line1) return null;

  const city =
    a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb ?? "";

  // ISO3166-2-lvl4 is "US-MD" format — clean to "MD".
  let state = "";
  const iso = a["ISO3166-2-lvl4"];
  if (iso && iso.length >= 5) state = iso.slice(-2).toUpperCase();
  if (!state && a.state) {
    state = STATE_NAME_TO_CODE[a.state.toLowerCase()] ?? "";
  }

  const zip = a.postcode ?? "";

  if (!city || !state) return null;

  const label = [line1, city, `${state} ${zip}`.trim()]
    .filter(Boolean)
    .join(", ");

  return { label, line1, city, state, zip };
}

/**
 * Fetch up to 5 US address suggestions for a query string. Returns an
 * empty array on any failure (network, rate limit, parse error) — the
 * caller should treat absence of suggestions as "still typing, no
 * help available right now" and not surface an error to the user.
 */
export async function fetchAddressSuggestions(
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 4) return []; // too short to be useful

  const url =
    NOMINATIM_BASE +
    "?" +
    new URLSearchParams({
      q,
      format: "jsonv2",
      addressdetails: "1",
      countrycodes: "us",
      limit: "5",
    }).toString();

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      signal: opts.signal,
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as NominatimRow[];
    return rows
      .map(toSuggestion)
      .filter((s): s is AddressSuggestion => s !== null);
  } catch (err: any) {
    if (err?.name === "AbortError") throw err; // let callers know
    return [];
  }
}
