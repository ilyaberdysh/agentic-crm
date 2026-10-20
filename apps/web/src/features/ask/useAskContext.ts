import type { AiContext } from '@agentic-crm/contracts';
import { useEffect } from 'react';
import { registerAskContext } from './store';

/**
 * Registers what the user is looking at (a record, a call, a meeting, a list) while the calling component is
 * mounted. Ask AI attaches it to every message and shows it as the context chip of the composer. Pass `null` to
 * register nothing. The context is compared by its JSON, so an inline object literal is fine.
 */
export function useAskContext(context: AiContext | null): void {
  const key = context ? JSON.stringify(context) : '';
  useEffect(() => {
    if (!key) return;
    return registerAskContext(JSON.parse(key) as AiContext);
  }, [key]);
}
