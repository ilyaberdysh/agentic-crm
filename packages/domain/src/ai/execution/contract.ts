/** Local experiment only. Deliberately separate from inference and all CRM capabilities. */
export interface ExecutionLimits {
  firstEventMs: number;
  idleMs: number;
  totalMs: number;
  maxOutputBytes: number;
  killGraceMs: number;
}

export interface SyntheticExecutionRequest {
  dataClass: 'synthetic';
  prompt: string;
  /** An existing, empty, dedicated directory. Never a repository or a CRM attachment mount. */
  workingDirectory: string;
  nativeTools: 'disabled';
  crmAccess: 'disabled';
  signal?: AbortSignal;
}

export type ExecutionEvent =
  | { type: 'started'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'completed'; inputTokens: number | null; outputTokens: number | null };

export interface ExecutionResult {
  adapter: string;
  executableVersion: string;
  sessionId: string;
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: 'unknown';
  executionHost: 'local-experiment';
  dataDestination: 'cli-vendor';
  isolation: 'not-production-sandboxed';
}

export type ExecutionErrorCode =
  | 'invalid_request'
  | 'missing_executable'
  | 'incompatible_cli'
  | 'unauthenticated'
  | 'canceled'
  | 'first_event_timeout'
  | 'idle_timeout'
  | 'total_timeout'
  | 'output_limit'
  | 'invalid_output'
  | 'native_tool_denied'
  | 'sandbox_unavailable'
  | 'sandbox_conformance_failed'
  | 'sandbox_cleanup_failed'
  | 'disconnected'
  | 'process_failed';

export class ExecutionError extends Error {
  constructor(
    readonly code: ExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}

export interface ExecutionAdapter {
  readonly kind: 'local-experiment';
  execute(request: SyntheticExecutionRequest, onEvent?: (event: ExecutionEvent) => void): Promise<ExecutionResult>;
}
