import { describe, expect, it } from 'vitest';
import { CodexContainerSandbox } from '../src/ai/execution/codex-container.js';

// Explicit host acceptance gate: real Podman and a preloaded digest-pinned image, no credentials or inference.
// An unset gate is skipped, never reported as a successful sandbox check.
const image = process.env.CRM_CODEX_SANDBOX_IMAGE;
const runtimeExecutable = process.env.CRM_CODEX_SANDBOX_PODMAN;
describe.skipIf(!image || !runtimeExecutable)('live Linux rootless Podman sandbox conformance', () => {
  it('probes the actual kernel boundary and confirms container removal', async () => {
    const sandbox = new CodexContainerSandbox({
      runtimeExecutable: runtimeExecutable ?? '',
      image: image ?? '',
      egressHosts: ['api.openai.com'],
    });
    await expect(sandbox.checkConformance()).resolves.toMatchObject({ boundary: 'rootless-podman-v1', image });
  }, 90_000);
});
