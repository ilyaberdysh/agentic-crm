// The same AES-256-GCM / HKDF-SHA256 design as Google SecretBox, with a separate purpose key and row-bound AAD.
// Google keys, ciphertext, cookies, and their historical AAD are deliberately unchanged.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { isSealedValue, type SealedValue } from '../connectors/google/crypto.ts';

export interface ProviderConnectionBinding {
  workspaceId: string;
  connectionId: string;
  ownerKind: 'workspace' | 'member';
  ownerId: string;
  provider: 'anthropic' | 'openai';
}

const aad = (binding: ProviderConnectionBinding) =>
  Buffer.from(
    JSON.stringify([
      'agentic-crm:provider-connection:v1',
      binding.workspaceId.toLowerCase(),
      binding.connectionId.toLowerCase(),
      binding.ownerKind,
      binding.ownerId.toLowerCase(),
      binding.provider,
    ]),
  );

/** Internal at-rest primitive. Intentionally exposes no plaintext-returning method. */
export class ProviderConnectionSecrets {
  readonly #key: Buffer;
  readonly #kid: string;

  constructor(master: Buffer) {
    if (master.length !== 32) throw new Error('The encryption key must be 32 bytes');
    this.#key = Buffer.from(hkdfSync('sha256', master, 'agentic-crm', 'provider-connection-credentials-v1', 32));
    this.#kid = createHash('sha256').update(this.#key).digest('hex').slice(0, 16);
  }

  seal(apiKey: string, binding: ProviderConnectionBinding): SealedValue {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(aad(binding));
    const plaintext = Buffer.from(JSON.stringify({ apiKey }));
    try {
      const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        v: 1,
        alg: 'A256GCM',
        kid: this.#kid,
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        data: data.toString('base64url'),
      };
    } finally {
      plaintext.fill(0);
    }
  }

  /** Local integrity check only: never claims that a provider has accepted the key. */
  isReadable(sealed: unknown, binding: ProviderConnectionBinding): boolean {
    if (!isSealedValue(sealed) || sealed.kid !== this.#kid) return false;
    let plaintext: Buffer | undefined;
    try {
      const iv = Buffer.from(sealed.iv, 'base64url');
      const tag = Buffer.from(sealed.tag, 'base64url');
      if (iv.length !== 12 || tag.length !== 16) return false;
      const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
      decipher.setAAD(aad(binding));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]);
      const value: unknown = JSON.parse(plaintext.toString('utf8'));
      return (
        value !== null &&
        typeof value === 'object' &&
        Object.keys(value).length === 1 &&
        'apiKey' in value &&
        typeof value.apiKey === 'string' &&
        /^[\x21-\x7e]{1,8192}$/.test(value.apiKey)
      );
    } catch {
      return false;
    } finally {
      plaintext?.fill(0);
    }
  }
}
