import { DomainError } from '../../errors.ts';
import { InferenceError } from '../inference.ts';
import { FakeLlm } from '../llm.ts';
import { CompatibilityInferenceAdapter } from './compatibility.ts';

/** Existing scripted rules and fixtures, exposed through the portable contract. */
export class FakeInferenceAdapter extends CompatibilityInferenceAdapter {
  readonly provider = 'fake';

  constructor(readonly fake = new FakeLlm()) {
    super(fake);
  }

  protected normalizeError(error: unknown): InferenceError {
    if (error instanceof InferenceError) return error;
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError')) {
      return new InferenceError('canceled', 'Inference was canceled');
    }
    if (error instanceof DomainError) {
      if (error.code === 'AI_NOT_CONFIGURED') return new InferenceError('not_configured', error.message);
      if (error.statusCode === 429) return new InferenceError('rate_limit', error.message, true, 429);
      if (error.details.reason === 'invalid-tool-json') return new InferenceError('invalid_response', error.message);
      const status = error.details.provider_status;
      if (typeof status === 'number' && status >= 500) {
        return new InferenceError('transient', error.message, true, status);
      }
    }
    return new InferenceError('provider', error instanceof Error ? error.message : 'Fake inference failed');
  }
}
