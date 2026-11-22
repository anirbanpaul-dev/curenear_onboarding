import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Server-only credential helpers. Kept in the db package because both the seed
 * script and the web server need them; nothing here is imported by the browser.
 *
 * Hashes are argon2id (WASM, so no native build is needed in Next, Docker or CI).
 * Rows written by the older scrypt scheme still verify, so nobody is locked out;
 * `passwordNeedsRehash` upgrades them on the next successful sign-in.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SCRYPT_SCHEME = 'scrypt';
const ARGON_PREFIX = '$argon2';

// OWASP baseline: 19 MiB, 2 iterations, 1 lane.
const ARGON_MEMORY_KIB = 19_456;
const ARGON_ITERATIONS = 2;
const ARGON_PARALLELISM = 1;
const ARGON_HASH_LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: new Uint8Array(randomBytes(16)),
    memorySize: ARGON_MEMORY_KIB,
    iterations: ARGON_ITERATIONS,
    parallelism: ARGON_PARALLELISM,
    hashLength: ARGON_HASH_LENGTH,
    outputType: 'encoded',
  });
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== SCRYPT_SCHEME || !salt || !digest) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH);
  const expected = Buffer.from(digest, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith(ARGON_PREFIX)) {
    try {
      return await argon2Verify({ password, hash: stored });
    } catch {
      return false;
    }
  }
  return verifyScrypt(password, stored);
}

/** True for hashes written by the old scrypt scheme. */
export function passwordNeedsRehash(stored: string): boolean {
  return !stored.startsWith(ARGON_PREFIX);
}

let dummyHash: Promise<string> | null = null;

/**
 * A real argon2id hash of a random password. Verifying against it keeps sign-in
 * timing flat when the email does not exist, without inventing a known password.
 */
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}

/** Opaque session token: 256 bits of entropy, only its SHA-256 hash is stored. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Temporary password for an admin-created account: 16 characters from an
 * unambiguous alphabet, grouped for reading aloud. It still has to be replaced
 * at first sign-in, so it is a hand-off secret, not a long-term credential.
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let index = 0; index < 16; index += 1) {
    out += alphabet[bytes[index]! % alphabet.length];
    if (index === 3 || index === 7 || index === 11) out += '-';
  }
  return out;
}

/** Single-use password reset token; stored as a hash like session tokens. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
