import type { AiModelsOutput } from '@agentic-crm/contracts';

/** Without a server key, a new chat starts on the first available saved target. Explicit choices stay pinned. */
export function defaultAskModel(models: AiModelsOutput | undefined, preferred?: string | null): string {
  if (!models) return preferred ?? 'auto';
  if (preferred && models.models.some((m) => m.id === preferred && !m.isUnavailable)) return preferred;
  if (models.models.some((m) => m.isAuto && !m.isUnavailable)) return 'auto';
  return models.models.find((m) => !m.isUnavailable)?.id ?? 'auto';
}
