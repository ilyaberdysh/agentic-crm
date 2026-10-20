import type { AiContext } from '@agentic-crm/contracts';
import { Button, Tooltip } from '@agentic-crm/ui';
import { openAsk } from './store';

/**
 * The "Ask AI" button of page headers (secondary 28, speech bubble): opens the side panel with the page's context
 * (what pages registered through `useAskContext`, or the `context` given here).
 */
export function AskButton({ context, tooltip = true }: { context?: AiContext; tooltip?: boolean }) {
  const button = (
    <Button
      variant="secondary"
      size={28}
      icon="chat"
      data-testid="ask-button"
      onPress={() => openAsk(context ? { context } : {})}
    >
      Ask AI
    </Button>
  );
  return tooltip ? (
    <Tooltip content="Ask AI" shortcut={['mod', 'j']}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
