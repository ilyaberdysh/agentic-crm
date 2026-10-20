// Secrets at rest for provider connectors (7.09): OAuth tokens are sealed with AES-256-GCM before they reach
// connected_accounts.credentials, and the OAuth round trip (signed `state`, sealed PKCE cookie) uses keys derived
// from the same master key (HKDF-SHA256, one sub-key per purpose). The master key is AGENTIC_CRM_ENCRYPTION_KEY; in dev a
// stable key is derived from AUTH_SECRET and a warning is printed once. A sealed value records the key id it was
// sealed with, so a changed key is reported as such (the mailbox then asks to reconnect) instead of failing opaquely.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** The key cannot open a sealed value (different key, or tampered data). */
export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealError';
  }
}

let warnedDevKey = false;

function parseKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return bytes.length === 32 ? bytes : null;
}

/**
 * The 32-byte master key: AGENTIC_CRM_ENCRYPTION_KEY (64 hex characters or base64), else (dev only) a key derived from the
 * session secret. Production without a key throws: tokens must not be sealed with a guessable key.
 */
export function resolveEncryptionKey(
  raw: string | undefined,
  fallbackSecret: string,
  options: { production: boolean; warn?: (message: string) => void },
): Buffer {
  if (raw) {
    const key = parseKey(raw);
    if (!key) {
      throw new Error(
        'AGENTIC_CRM_ENCRYPTION_KEY must be 32 bytes: 64 hex characters or base64 (e.g. `openssl rand -hex 32`)',
      );
    }
    return key;
  }
  if (options.production) {
    throw new Error('AGENTIC_CRM_ENCRYPTION_KEY must be set in production to store Google credentials');
  }
  if (!warnedDevKey) {
    warnedDevKey = true;
    (options.warn ?? ((m: string) => console.warn(m)))(
      '[agentic-crm] AGENTIC_CRM_ENCRYPTION_KEY is not set: OAuth tokens are encrypted with a key derived from AUTH_SECRET (dev only).',
    );
  }
  return Buffer.from(hkdfSync('sha256', fallbackSecret, 'agentic-crm', 'dev-encryption-key-v1', 32));
}

const subKey = (master: Buffer, purpose: string) => Buffer.from(hkdfSync('sha256', master, 'agentic-crm', purpose, 32));

const b64url = (b: Buffer) => b.toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');

/** A sealed credentials value as stored in jsonb. */
export interface SealedValue {
  v: 1;
  alg: 'A256GCM';
  /** First 16 hex of sha256(credentials key): which key sealed it. */
  kid: string;
  iv: string;
  tag: string;
  data: string;
}

export function isSealedValue(value: unknown): value is SealedValue {
  const v = value as Partial<SealedValue> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    v.v === 1 &&
    v.alg === 'A256GCM' &&
    typeof v.kid === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.tag === 'string' &&
    typeof v.data === 'string'
  );
}

function encrypt(key: Buffer, plaintext: Buffer, aad: string): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}

function decrypt(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const CREDENTIALS_AAD = 'agentic-crm:credentials:v1';
const COOKIE_AAD = 'agentic-crm:oauth-cookie:v1';

/** Seals / opens credentials and OAuth round-trip values with sub-keys of one master key. */
export class SecretBox {
  private readonly credentialsKey: Buffer;
  private readonly cookieKey: Buffer;
  private readonly stateKey: Buffer;
  readonly kid: string;

  constructor(master: Buffer) {
    if (master.length !== 32) throw new Error('The encryption key must be 32 bytes');
    this.credentialsKey = subKey(master, 'credentials-v1');
    this.cookieKey = subKey(master, 'oauth-cookie-v1');
    this.stateKey = subKey(master, 'oauth-state-v1');
    this.kid = createHash('sha256').update(this.credentialsKey).digest('hex').slice(0, 16);
  }

  /** JSON value → sealed jsonb value (credentials at rest). */
  seal(value: unknown): SealedValue {
    const { iv, tag, data } = encrypt(this.credentialsKey, Buffer.from(JSON.stringify(value)), CREDENTIALS_AAD);
    return { v: 1, alg: 'A256GCM', kid: this.kid, iv: b64url(iv), tag: b64url(tag), data: b64url(data) };
  }

  /** Sealed jsonb value → JSON value. Throws SealError when the key differs or the value was tampered with. */
  open<T>(sealed: unknown): T {
    if (!isSealedValue(sealed)) throw new SealError('The stored credentials are not readable');
    if (sealed.kid !== this.kid) throw new SealError('The credentials were sealed with another encryption key');
    try {
      const plain = decrypt(
        this.credentialsKey,
        fromB64url(sealed.iv),
        fromB64url(sealed.tag),
        fromB64url(sealed.data),
        CREDENTIALS_AAD,
      );
      return JSON.parse(plain.toString('utf8')) as T;
    } catch {
      throw new SealError('The stored credentials could not be decrypted');
    }
  }

  /** Compact sealed string (cookie value): base64url(iv ‖ tag ‖ ciphertext). */
  sealCompact(value: unknown): string {
    const { iv, tag, data } = encrypt(this.cookieKey, Buffer.from(JSON.stringify(value)), COOKIE_AAD);
    return b64url(Buffer.concat([iv, tag, data]));
  }

  /** Opens a compact sealed string; null when it is not one of ours. */
  openCompact<T>(value: string): T | null {
    try {
      const raw = fromB64url(value);
      if (raw.length < 29) return null;
      const plain = decrypt(this.cookieKey, raw.subarray(0, 12), raw.subarray(12, 28), raw.subarray(28), COOKIE_AAD);
      return JSON.parse(plain.toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  /** `base64url(json).base64url(hmac)`: integrity-protected (not secret) value, e.g. the OAuth state. */
  sign(value: unknown): string {
    const payload = b64url(Buffer.from(JSON.stringify(value)));
    const mac = createHmac('sha256', this.stateKey).update(payload).digest();
    return `${payload}.${b64url(mac)}`;
  }

  /** Verifies a signed value; null when the signature does not match. */
  verify<T>(signed: string): T | null {
    const [payload, mac, extra] = signed.split('.');
    if (!payload || !mac || extra !== undefined) return null;
    const expected = createHmac('sha256', this.stateKey).update(payload).digest();
    const given = fromB64url(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      return JSON.parse(fromB64url(payload).toString('utf8')) as T;
    } catch {
      return null;
    }
  }
}
