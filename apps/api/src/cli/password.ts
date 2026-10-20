import { randomInt } from 'node:crypto';

// No look-alike characters (0/O, 1/l/I).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Random password for team accounts created by the admin CLI (~114 bits at the default length). */
export function generatePassword(length = 20): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
