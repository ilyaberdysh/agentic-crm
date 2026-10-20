// Minimal S3 client (CROSS-DOMAIN B.23, decision D-19): AWS Signature V4 presigned URLs for browser uploads and
// downloads, plus signed server-side calls (bucket bootstrap, HEAD to verify an upload, PUT for the public API's
// multipart upload, DELETE). Path-style addressing, which SeaweedFS (local) and MinIO expect. Region us-east-1.
import { createHash, createHmac } from 'node:crypto';

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** Origin the browser uses to reach the endpoint, when it differs (e.g. a proxy). Defaults to `endpoint`. */
  publicEndpoint?: string;
}

export interface ObjectStorage {
  ensureBucket(): Promise<void>;
  presignPut(key: string, options: { contentType: string; expiresInSeconds: number }): string;
  presignGet(
    key: string,
    options: {
      expiresInSeconds: number;
      filename?: string;
      disposition?: 'attachment' | 'inline';
      contentType?: string;
    },
  ): string;
  head(key: string): Promise<{ contentLength: number; contentType: string | null } | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as S3 expects (keeps unreserved characters; '/' optional). */
function encode(value: string, keepSlash = false): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /$^/, '/');
}

function amzDate(now: Date): { date: string; stamp: string } {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { date: stamp.slice(0, 8), stamp };
}

export class S3Storage implements ObjectStorage {
  private readonly region: string;
  private bucketReady: Promise<void> | null = null;

  constructor(private readonly config: S3Config) {
    this.region = config.region ?? 'us-east-1';
  }

  private objectPath(key: string): string {
    return `/${encode(this.config.bucket)}/${encode(key, true)}`;
  }

  private signingKey(date: string): Buffer {
    const kDate = hmac(`AWS4${this.config.secretAccessKey}`, date);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    return hmac(kService, 'aws4_request');
  }

  /** Query-string signed URL (presigned). */
  private presign(method: string, path: string, expiresInSeconds: number, extra: Record<string, string> = {}): string {
    const publicBase = new URL(this.config.publicEndpoint ?? this.config.endpoint);
    const { date, stamp } = amzDate(new Date());
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const params: Record<string, string> = {
      ...extra,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.config.accessKeyId}/${scope}`,
      'X-Amz-Date': stamp,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': 'host',
    };
    const query = Object.keys(params)
      .sort()
      .map((k) => `${encode(k)}=${encode(params[k] as string)}`)
      .join('&');
    // The signature covers the host the client will call.
    const host = publicBase.host;
    const canonical = [method, path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
    const signature = createHmac('sha256', this.signingKey(date)).update(toSign).digest('hex');
    return `${publicBase.origin}${path}?${query}&X-Amz-Signature=${signature}`;
  }

  /** Header-signed server-side request. */
  private async request(
    method: string,
    path: string,
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const url = new URL(this.config.endpoint);
    const { date, stamp } = amzDate(new Date());
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const payloadHash = body ? sha256(body) : sha256('');
    const all: Record<string, string> = {
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
    };
    const names = Object.keys(all).sort();
    const canonicalHeaders = names.map((n) => `${n}:${(all[n] as string).trim()}\n`).join('');
    const signedHeaders = names.join(';');
    const canonical = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
    const signature = createHmac('sha256', this.signingKey(date)).update(toSign).digest('hex');
    const { host: _host, ...sent } = all;
    return fetch(`${url.origin}${path}`, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      ...(body ? { body: body as unknown as RequestInit['body'] } : {}),
    });
  }

  /** Creates the bucket once per process (idempotent: an existing bucket is fine). */
  ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const path = `/${encode(this.config.bucket)}`;
      const head = await this.request('HEAD', path);
      if (head.ok) return;
      const res = await this.request('PUT', path);
      if (!res.ok && res.status !== 409)
        throw new Error(`S3 bucket bootstrap failed: ${res.status} ${await res.text()}`);
    })().catch((err) => {
      this.bucketReady = null;
      throw err;
    });
    return this.bucketReady;
  }

  presignPut(key: string, options: { contentType: string; expiresInSeconds: number }): string {
    void options.contentType; // not signed: the browser sends it as a normal header
    return this.presign('PUT', this.objectPath(key), options.expiresInSeconds);
  }

  presignGet(
    key: string,
    options: {
      expiresInSeconds: number;
      filename?: string;
      disposition?: 'attachment' | 'inline';
      contentType?: string;
    },
  ): string {
    const extra: Record<string, string> = {};
    if (options.filename) {
      const ascii = options.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
      extra['response-content-disposition'] =
        `${options.disposition ?? 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encode(options.filename)}`;
    }
    if (options.contentType) extra['response-content-type'] = options.contentType;
    return this.presign('GET', this.objectPath(key), options.expiresInSeconds, extra);
  }

  async head(key: string): Promise<{ contentLength: number; contentType: string | null } | null> {
    const res = await this.request('HEAD', this.objectPath(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 HEAD failed: ${res.status}`);
    return {
      contentLength: Number(res.headers.get('content-length') ?? 0),
      contentType: res.headers.get('content-type'),
    };
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.ensureBucket();
    const res = await this.request('PUT', this.objectPath(key), body, { 'content-type': contentType });
    if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${await res.text()}`);
  }

  async delete(key: string): Promise<void> {
    const res = await this.request('DELETE', this.objectPath(key));
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE failed: ${res.status}`);
  }
}
