/**
 * AddressFields — shared US-address input with Google Places autocomplete.
 *
 * v0.7.0.18: extracted from WelcomeSheet so the Send tab and AddFriendSheet
 * can use the same component. Previously, only the welcome flow had
 * Places-aware autofill; the other two surfaces forced users to type into
 * 4-5 separate text inputs (street, apt, city, state, zip) with no
 * suggestions. Result: address quality was worse on the surfaces that
 * actually matter for repeat sending. One component, three surfaces, same
 * UX everywhere.
 *
 * Shape:
 *   - Single primary text input. As the user types, debounced calls to
 *     Google Places (New) surface up to 5 suggestions. Tap one → structured
 *     fields (line1, city, state, zip) auto-fill via Place Details.
 *   - Free-form fallback parser handles paste of "5209 Dorset Ave, Chevy
 *     Chase MD 20815" type strings — useful when the user has their address
 *     already in their clipboard.
 *   - Separate `Apt / suite / unit` text input below, optional. Stored in
 *     `address.line2`. Lives in its own field because Google doesn't
 *     reliably return apt info AND because re-editing the main address
 *     shouldn't wipe a manually-typed apartment.
 *
 * State is owned by the parent via `address` + `onChange` — this component
 * is controlled. The parent decides validation (typically
 * `isAddressComplete(address)` from src/types/address.ts).
 */

import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  AddressSuggestion,
  fetchAddressSuggestions,
  fetchPlaceDetails,
  newSessionToken,
} from "@/src/services/addressAutocomplete";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import type { AddressDraft } from "@/src/types/address";

export function AddressFields({
  address,
  onChange,
  testIDPrefix,
  label,
  placeholder = "5209 Dorset Ave, Boise, ID 83706",
}: {
  address: AddressDraft;
  onChange: (a: AddressDraft) => void;
  testIDPrefix: string;
  /** Defaults to "Their address". Override for "Your address", etc. */
  label?: string;
  /** Override the placeholder if you want a different example. */
  placeholder?: string;
}) {
  // The main textbox holds line1 + city + state + zip. line2 (apt/suite)
  // lives below so it doesn't get blown away when the user re-edits.
  const [raw, setRaw] = useState<string>(() => addressToTextNoLine2(address));
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  // Google Places session token. One token per "type-then-pick" cycle
  // groups all autocomplete + the final getPlace call as ONE billable
  // session — cheaper than per-request billing.
  const sessionTokenRef = useRef<string>(newSessionToken());

  // Keep the raw textbox in sync if the parent updates address (e.g. from
  // an external setter like a "use saved address" tap).
  useEffect(() => {
    const expected = addressToTextNoLine2(address);
    setRaw((prev) => (prev === expected ? prev : expected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.line1, address.city, address.state, address.zip]);

  // Debounced Google Places lookup. 350ms after the last keystroke.
  // Aborts in-flight on new keystrokes so only the latest query's
  // results show up.
  useEffect(() => {
    if (raw.trim().length < 3) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const rows = await fetchAddressSuggestions(raw, {
          signal: ac.signal,
          sessionToken: sessionTokenRef.current,
        });
        setSuggestions(rows);
      } catch {
        /* aborted or network error — fall through silently */
      } finally {
        setLoadingSuggestions(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [raw]);

  async function applySuggestion(s: AddressSuggestion) {
    // Two-call billing pattern: Place Details ends the session. Rotate
    // the session token after so the next autocomplete starts a fresh
    // billable session.
    const details = await fetchPlaceDetails(s.placeId, {
      sessionToken: sessionTokenRef.current,
    });
    sessionTokenRef.current = newSessionToken();
    if (!details) {
      // Couldn't resolve full fields. Fall back to the raw label so the
      // user isn't blocked — they can edit the apt field manually.
      setRaw(s.label);
      setShowSuggestions(false);
      setSuggestions([]);
      return;
    }
    // Preserve any apt/suite the user already typed. If Google returned
    // a subpremise AND the user hasn't typed one, prefer Google's.
    const next: AddressDraft = {
      name: address.name,
      line1: details.line1,
      line2: address.line2 || details.line2 || "",
      city: details.city,
      state: details.state,
      zip: details.zip,
    };
    setRaw(addressToTextNoLine2(next));
    setShowSuggestions(false);
    setSuggestions([]);
    onChange(next);
  }

  return (
    <>
      <FieldLabel style={{ marginTop: 14 }}>{label ?? "Their address"}</FieldLabel>
      <TextInput
        value={raw}
        onChangeText={(v) => {
          setRaw(v);
          setShowSuggestions(true);
          const parsed = parseFreeFormAddress(v);
          if (parsed) {
            // Preserve the apt field + name if already populated.
            onChange({ ...parsed, name: address.name, line2: address.line2 || parsed.line2 });
          } else {
            onChange({
              name: address.name,
              line1: v.trim(),
              line2: address.line2 || "",
              city: "",
              state: "",
              zip: "",
            });
          }
        }}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="words"
        autoCorrect={false}
        textContentType="fullStreetAddress"
        autoComplete="postal-address"
        multiline
        style={[fieldStyles.input, { minHeight: 64, textAlignVertical: "top" }]}
        testID={`${testIDPrefix}-address`}
      />

      {showSuggestions && suggestions.length > 0 ? (
        <View style={fieldStyles.suggestions} testID={`${testIDPrefix}-suggestions`}>
          {suggestions.map((s, i) => (
            <Pressable
              key={`${s.label}-${i}`}
              onPress={() => applySuggestion(s)}
              style={({ pressed }) => [
                fieldStyles.suggestionRow,
                pressed && fieldStyles.suggestionRowPressed,
                i < suggestions.length - 1 && fieldStyles.suggestionRowBorder,
              ]}
              testID={`${testIDPrefix}-suggestion-${i}`}
            >
              <Text style={fieldStyles.suggestionText} numberOfLines={2}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {loadingSuggestions ? (
        <Text style={fieldStyles.helper}>Looking up addresses...</Text>
      ) : address.line1.trim().length === 0 ? (
        <Text style={fieldStyles.helper}>Start typing — we'll suggest addresses.</Text>
      ) : null}

      <FieldLabel style={{ marginTop: 14 }}>Apt, suite, unit (optional)</FieldLabel>
      <TextInput
        value={address.line2 ?? ""}
        onChangeText={(v) => onChange({ ...address, line2: v })}
        placeholder="Apt 4B"
        placeholderTextColor={colors.mutedInk}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="address-line2"
        textContentType="sublocality"
        style={fieldStyles.input}
        testID={`${testIDPrefix}-address-line2`}
      />
    </>
  );
}

function FieldLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
}) {
  return <Text style={[fieldStyles.label, style]}>{children}</Text>;
}

// ============================================================================
// Free-form address parsing — used both by the AddressFields textbox (so
// pasting "5209 Dorset Ave, Chevy Chase MD 20815" populates structured
// fields without waiting on Places) and by external callers (WelcomeSheet's
// "use a saved address" path, AddFriendSheet's paste support).
// ============================================================================

/** Convert a structured AddressDraft into the display string for the
 *  single textbox. Includes line2 — call sites with a dedicated apt
 *  field should use addressToTextNoLine2 instead. */
export function addressToText(a: AddressDraft): string {
  const parts: string[] = [];
  if (a.line1) parts.push(a.line1);
  if (a.line2) parts.push(a.line2);
  if (a.city) parts.push(a.city);
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);
  return parts.join(", ");
}

/** Display variant that omits line2 — used by AddressFields where the
 *  apt/suite lives in its own input so it doesn't round-trip through
 *  the main textbox. */
export function addressToTextNoLine2(a: AddressDraft): string {
  const parts: string[] = [];
  if (a.line1) parts.push(a.line1);
  if (a.city) parts.push(a.city);
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  if (stateZip) parts.push(stateZip);
  return parts.join(", ");
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};

const ALL_STATE_PATTERNS: Array<{ pattern: RegExp; code: string }> = (() => {
  const entries: Array<{ name: string; code: string }> = [];
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    entries.push({ name, code });
    entries.push({ name: code.toLowerCase(), code });
  }
  entries.sort((a, b) => b.name.length - a.name.length);
  return entries.map(({ name, code }) => ({
    pattern: new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i"),
    code,
  }));
})();

function stripCountry(input: string): string {
  return input
    .replace(/,?\s*(United States of America|United States|U\.?S\.?A\.?)\s*$/i, "")
    .trim()
    .replace(/,$/, "")
    .trim();
}

function extractCityStateZip(
  s: string,
): { city: string; state: string; zip: string; rest: string } | null {
  const zipMatch = s.match(/\b(\d{5}(?:-\d{4})?)\s*$/);
  if (!zipMatch) return null;
  const zip = zipMatch[1];
  const beforeZip = s.slice(0, zipMatch.index).trim().replace(/,$/, "").trim();
  if (!beforeZip) return null;

  for (const { pattern, code } of ALL_STATE_PATTERNS) {
    const endPattern = new RegExp(pattern.source + "\\s*$", "i");
    const m = beforeZip.match(endPattern);
    if (m && m.index !== undefined) {
      const beforeState = beforeZip.slice(0, m.index).trim().replace(/,$/, "").trim();
      if (!beforeState) continue;
      const lastComma = beforeState.lastIndexOf(",");
      const city =
        lastComma >= 0
          ? beforeState.slice(lastComma + 1).trim()
          : beforeState;
      if (!city) continue;
      const rest = lastComma >= 0 ? beforeState.slice(0, lastComma).trim() : "";
      return { city, state: code, zip, rest };
    }
  }
  return null;
}

function matchStateZipChunk(s: string): { state: string; zip: string } | null {
  const trimmed = s.trim();
  const m1 = trimmed.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m1) return { state: m1[1].toUpperCase(), zip: m1[2] };
  const m2 = trimmed.match(/^(.+?)\s+(\d{5}(?:-\d{4})?)$/);
  if (m2) {
    const stateName = m2[1].trim().toLowerCase();
    const code = STATE_NAME_TO_CODE[stateName];
    if (code) return { state: code, zip: m2[2] };
  }
  return null;
}

/**
 * Forgiving free-form address parser. Handles iOS autocomplete /
 * clipboard paste shapes:
 *   "5209 Dorset Avenue, Chevy Chase Maryland 20815, USA"
 *   "412 SE Belmont, Portland, OR 97214"
 *   "412 SE Belmont, Portland, Oregon, 97214"
 *   "5209 Dorset Ave Apt 4B, Boise, ID 83706"
 *
 * Returns null if it can't extract a usable address.
 */
export function parseFreeFormAddress(input: string): AddressDraft | null {
  let cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  cleaned = stripCountry(cleaned);
  if (!cleaned) return null;

  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);

  // Strategy 0: comma-aware. If LAST chunk matches "STATE ZIP" and
  // there are ≥ 3 chunks, structure is unambiguous.
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    const stateZip = matchStateZipChunk(last);
    if (stateZip) {
      const city = parts[parts.length - 2];
      const before = parts.slice(0, parts.length - 2);
      return {
        name: "",
        line1: before[0] ?? "",
        line2: before.length > 1 ? before.slice(1).join(", ") : "",
        city,
        state: stateZip.state,
        zip: stateZip.zip,
      };
    }
  }

  // Strategy A: scan from the END of the joined string for "City State ZIP".
  const joined = parts.join(", ");
  const extracted = extractCityStateZip(joined);
  if (extracted) {
    const restParts = extracted.rest
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const line1 = restParts[0] ?? "";
    const line2 = restParts.length > 1 ? restParts.slice(1).join(", ") : "";
    if (line1) {
      return {
        name: "",
        line1,
        line2,
        city: extracted.city,
        state: extracted.state,
        zip: extracted.zip,
      };
    }
  }

  // Strategy B fallback: state and zip in separate comma chunks.
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    const lastIsZip = /^\d{5}(?:-\d{4})?$/.test(last);
    if (lastIsZip) {
      const stateChunk = parts[parts.length - 2].toLowerCase();
      const stateCode = STATE_NAME_TO_CODE[stateChunk] ?? (/^[a-z]{2}$/.test(stateChunk) ? stateChunk.toUpperCase() : null);
      if (stateCode) {
        const city = parts[parts.length - 3];
        const before = parts.slice(0, parts.length - 3);
        return {
          name: "",
          line1: before[0] ?? "",
          line2: before.length > 1 ? before.slice(1).join(", ") : "",
          city,
          state: stateCode,
          zip: last,
        };
      }
    }
  }

  return null;
}

const fieldStyles = StyleSheet.create({
  label: {
    color: colors.mutedInk,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "rgba(245, 240, 230, 0.6)",
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1.2,
    color: colors.ink,
    fontFamily: fonts.serif,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  helper: {
    color: colors.mutedInk,
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  suggestions: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    marginTop: -2,
    overflow: "hidden",
  },
  suggestionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestionRowPressed: {
    backgroundColor: colors.paper,
  },
  suggestionRowBorder: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: {
    color: colors.ink,
    fontFamily: fonts.serif,
    fontSize: 14,
    lineHeight: 18,
  },
});
