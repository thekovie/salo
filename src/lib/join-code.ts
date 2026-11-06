/** Crockford base32 without I, L, O, U: nothing that reads as 1, 0 or a rude word when said aloud. */
export const JOIN_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const JOIN_CODE_LENGTH = 6;

/** What people type: spaces, dashes, lower case and look-alike letters are forgiven. */
export function normalizeJoinCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

export function isJoinCode(value: string): boolean {
  return value.length === JOIN_CODE_LENGTH && [...value].every((ch) => JOIN_CODE_ALPHABET.includes(ch));
}
