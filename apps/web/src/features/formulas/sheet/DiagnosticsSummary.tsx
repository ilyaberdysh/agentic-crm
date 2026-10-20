// Diagnostics summary of the helper header (formulas.md §4.4): warning triangle + the single message, or
// "Multiple errors (n)"; hovering opens a dark tooltip listing every diagnostic with "Line n" / "Lines a-b".
import type { Diagnostic } from '@agentic-crm/formula';
import { summarizeDiagnostics } from '@agentic-crm/formula';
import { Icon, Tooltip } from '@agentic-crm/ui';
import { Button as AriaButton } from 'react-aria-components';
import { lineLabel } from '../model/diagnostics';
import * as s from './sheet.css';

export function DiagnosticsSummary({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  const summary = summarizeDiagnostics([...diagnostics]);
  if (!summary) return null;
  return (
    <Tooltip
      placement="top"
      content={
        <span className={s.summaryList}>
          {diagnostics.map((d) => (
            <span key={`${d.from}:${d.to}:${d.code}`}>
              <span className={s.summaryLine}>{lineLabel(d)}</span>
              {d.message}
            </span>
          ))}
        </span>
      }
    >
      <AriaButton className={s.summary} aria-label={summary} data-testid="formula-diagnostics">
        <Icon icon="warning" size={16} />
        <span className={s.summaryText}>{summary}</span>
      </AriaButton>
    </Tooltip>
  );
}
