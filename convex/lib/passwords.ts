// Letters and digits that are hard to confuse when read out (no 0/o, 1/l/i).
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * A temporary password, e.g. "kq7m-p3rx": 8 random characters, easy to read
 * out loud. Shown once to the staff member who made it; the person must
 * choose their own when they next sign in. Never stored in plain text or
 * written to any log.
 */
export function temporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
