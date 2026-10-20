import { lookup } from 'node:dns/promises';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { BlockList, connect, isIPv4, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { ExecutionError } from './contract.js';

const forbidden = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  forbidden.addSubnet(address, prefix, 'ipv4');

/** Exact operator-owned DNS names. No IPs, wildcards, URLs, search domains, or port overrides. */
export function isEgressHostname(value: string) {
  return (
    value.length <= 253 &&
    value === value.toLowerCase() &&
    !isIPv4(value) &&
    value.includes('.') &&
    value.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  );
}

/** Resolve once, reject mixed/private answers, then connect to the selected numeric address. */
export async function resolveEgressAddress(
  hostname: string,
  resolve: (hostname: string) => Promise<{ address: string; family: number }[]> = (name) =>
    lookup(name, { family: 4, all: true, verbatim: true }),
) {
  const answers = await resolve(hostname);
  if (
    !answers.length ||
    answers.some((entry) => entry.family !== 4 || !isIPv4(entry.address) || forbidden.check(entry.address, 'ipv4'))
  ) {
    throw new ExecutionError(
      'sandbox_unavailable',
      'Vendor endpoint did not resolve exclusively to public IPv4 addresses.',
    );
  }
  const first = answers[0];
  if (!first) throw new ExecutionError('sandbox_unavailable', 'Vendor endpoint has no public IPv4 address.');
  return first.address;
}

/**
 * Runner-owned HTTPS CONNECT relay. The container has no IP network interface.
 * Opaque TLS is forwarded only to public addresses resolved for configured vendor names.
 * This is an egress boundary, not content inspection or protection against sending data to the vendor.
 */
export async function createVendorRelay(socketPath: string, hosts: readonly string[]) {
  if (!hosts.length || hosts.some((name) => !isEgressHostname(name))) {
    throw new ExecutionError('invalid_request', 'A strict vendor hostname allowlist is required.');
  }
  const allowed = new Set(hosts);
  const connections = new Set<Duplex>();
  const upstreams = new Set<Socket>();
  let bytes = 0;
  let closed = false;
  const closeConnections = () => {
    for (const socket of connections) socket.destroy();
    for (const socket of upstreams) socket.destroy();
  };
  const account = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 16_777_216) closeConnections();
  };
  const server = createServer({ maxHeaderSize: 4_096, headersTimeout: 5_000 }, (_req, response) => {
    response.writeHead(403).end();
  });
  server.on('connection', (socket) => {
    if (closed || connections.size >= 8 || bytes > 16_777_216) return socket.destroy();
    connections.add(socket);
    socket.setTimeout(30_000, () => socket.destroy());
    socket.on('close', () => connections.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.on('data', account);
  });
  server.on('connect', (request, downstream, head) => {
    const authority = request.url ?? '';
    const host = authority.endsWith(':443') ? authority.slice(0, -4) : '';
    if (closed || !allowed.has(host) || authority !== `${host}:443` || head.length > 16_384) {
      downstream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    downstream.pause();
    // The DNS deadline is covered independently of the generation and the upstream socket timeout.
    const timer = setTimeout(() => downstream.destroy(), 5_000);
    void resolveEgressAddress(host)
      .then((address) => {
        clearTimeout(timer);
        if (closed || downstream.destroyed) return;
        const upstream = connect({ host: address, port: 443, family: 4 });
        upstreams.add(upstream);
        const destroy = () => {
          downstream.destroy();
          upstream.destroy();
        };
        upstream.setTimeout(30_000, destroy);
        upstream.on('error', destroy);
        downstream.on('error', destroy);
        upstream.on('close', () => {
          upstreams.delete(upstream);
          downstream.destroy();
        });
        downstream.on('close', () => upstream.destroy());
        upstream.on('data', account);
        upstream.once('connect', () => {
          downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          downstream.pipe(upstream).pipe(downstream);
          downstream.resume();
        });
      })
      .catch(() => {
        clearTimeout(timer);
        downstream.destroy();
      });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600);
  return {
    async close() {
      closed = true;
      closeConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
