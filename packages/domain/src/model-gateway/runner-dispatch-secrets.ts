import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { InferenceRequest } from '../ai/inference.ts';
import { isSealedValue, type SealedValue } from '../connectors/google/crypto.ts';

export interface RunnerDispatchBinding {
  workspaceId: string;
  invocationId: string;
  runnerId: string;
  targetId: string;
  targetVersion: number;
}

function aad(binding: RunnerDispatchBinding, kind: 'request' | 'response'): Buffer {
  return Buffer.from(
    JSON.stringify([
      `agentic-crm:runner-model-${kind}:v1`,
      binding.workspaceId.toLowerCase(),
      binding.invocationId.toLowerCase(),
      binding.runnerId.toLowerCase(),
      binding.targetId.toLowerCase(),
      binding.targetVersion,
    ]),
  );
}

/** The database stores ciphertext; plaintext is returned only to an authenticated, leased runner. */
export class RunnerDispatchSecrets {
  readonly #key: Buffer;
  readonly #kid: string;

  constructor(master: Buffer) {
    if (master.length !== 32) throw new Error('The encryption key must be 32 bytes');
    this.#key = Buffer.from(hkdfSync('sha256', master, 'agentic-crm', 'runner-model-dispatch-v1', 32));
    this.#kid = createHash('sha256').update(this.#key).digest('hex').slice(0, 16);
  }

  private sealValue(value: unknown, binding: RunnerDispatchBinding, kind: 'request' | 'response'): SealedValue {
    const plaintext = Buffer.from(JSON.stringify(value));
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
      cipher.setAAD(aad(binding, kind));
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

  private openValue(sealed: unknown, binding: RunnerDispatchBinding, kind: 'request' | 'response'): unknown {
    if (!isSealedValue(sealed) || sealed.kid !== this.#kid) throw new Error('Runner dispatch is unreadable');
    let plaintext: Buffer | undefined;
    try {
      const iv = Buffer.from(sealed.iv, 'base64url');
      const tag = Buffer.from(sealed.tag, 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
      decipher.setAAD(aad(binding, kind));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new Error('Runner dispatch is unreadable');
    } finally {
      plaintext?.fill(0);
    }
  }

  seal(request: InferenceRequest, binding: RunnerDispatchBinding): SealedValue {
    return this.sealValue(request, binding, 'request');
  }

  open(sealed: unknown, binding: RunnerDispatchBinding): InferenceRequest {
    const value = this.openValue(sealed, binding, 'request');
    if (!value || typeof value !== 'object' || !Array.isArray((value as InferenceRequest).messages))
      throw new Error('Runner dispatch is unreadable');
    return value as InferenceRequest;
  }

  sealResponse(text: string, binding: RunnerDispatchBinding): SealedValue {
    return this.sealValue({ text }, binding, 'response');
  }

  openResponse(sealed: unknown, binding: RunnerDispatchBinding): string {
    const value = this.openValue(sealed, binding, 'response');
    if (!value || typeof value !== 'object' || typeof (value as { text?: unknown }).text !== 'string')
      throw new Error('Runner response is unreadable');
    return (value as { text: string }).text;
  }
}
