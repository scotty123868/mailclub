/**
 * Address types shared across the send flow + any friend-management surface
 * that collects a mailing address.
 *
 * Originally lived inside `src/components/RecipientPicker.tsx` (the old
 * single-page send screen's segmented control). The component became dead
 * code in v0.5.0 when the send flow split into 4 steps, so the address
 * primitives moved here. (codex P2 cleanup, Phase 2.5 review.)
 */

export type AddressDraft = {
 name: string;
 line1: string;
 line2?: string;
 city: string;
 state: string;
 zip: string;
};

export const EMPTY_ADDRESS: AddressDraft = {
 name: "",
 line1: "",
 line2: "",
 city: "",
 state: "",
 zip: "",
};

/**
 * USPS-deliverable test: a name, a street, a city, a state, and a 5- or 9-digit
 * ZIP. Not a USPS authoritative check. that ships when we wire Lob's address
 * verification API in 0.6.x.
 */
export function isAddressComplete(a: AddressDraft): boolean {
 return (
 a.name.trim().length > 0 &&
 a.line1.trim().length > 0 &&
 a.city.trim().length > 0 &&
 a.state.trim().length > 0 &&
 /^\d{5}(-\d{4})?$/.test(a.zip.trim())
 );
}
