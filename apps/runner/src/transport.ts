/** Never expose upstream bodies, URLs, credentials, prompts, or provider diagnostics in errors. */
export class RunnerError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'RunnerError';
  }
}

export function apiOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new RunnerError('invalid_api_origin');
  return url.origin;
}

/** Numeric loopback only: localhost is pinned here and never resolved through DNS. */
export function localEndpoint(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(url.hostname))
  )
    throw new RunnerError('invalid_local_endpoint');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.toString().replace(/\/+$/, '');
}

export async function boundedJson(response: Response, maxBytes = 524_288): Promise<unknown> {
  if (!response.body) throw new RunnerError('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new RunnerError('response_limit');
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof RunnerError) throw error;
    throw new RunnerError('invalid_response');
  } finally {
    reader.releaseLock();
  }
}

export class RunnerApi {
  readonly origin: string;
  constructor(
    origin: string,
    private readonly bearer?: string,
    private readonly requestFetch: typeof fetch = fetch,
  ) {
    this.origin = apiOrigin(origin);
  }

  async post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    try {
      const response = await this.requestFetch(new URL(path, this.origin), {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new RunnerError('api_rejected', response.status);
      }
      return await boundedJson(response);
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError(signal?.aborted ? 'canceled' : 'api_unavailable');
    }
  }
}
