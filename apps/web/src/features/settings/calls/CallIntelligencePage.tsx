// Settings → Call intelligence (BACKLOG 10.13; I calls §5.1; evidence/I/settings-call-intelligence.png, minus auto-record:
// mymeet records the calls). The member's "Default insights template": a select of the published templates, "None" at
// the bottom. The call page pre-selects it and the server applies it to calls the member takes part in.
import { Icon, Popover, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useCallSettings, useInsightTemplates, useUpdateCallSettings } from '../../calls/data';
import { pickableTemplates, templateTitle } from '../../calls/model';
import * as p from '../../calls/page.css';
import { SettingsPage, SettingsSection } from '../SettingsPage';
import { findSettingsEntry } from '../settingsNav';

/** Paths (below `settings/`) of the pages this module serves; the placeholder generator skips them. */
export const CALL_SETTINGS_PATHS: readonly string[] = ['call-intelligence'];

function DefaultTemplateSelect() {
  const settings = useCallSettings();
  const templates = useInsightTemplates({ enabledOnly: true });
  const update = useUpdateCallSettings();
  const [query, setQuery] = useState('');
  const selectedId = settings.data?.defaultInsightTemplateId ?? null;
  const all = templates.data ?? [];
  const selected = all.find((t) => t.id === selectedId);
  const list = pickableTemplates(all, query);
  const choose = (id: string | null, close: () => void) => {
    close();
    update.mutate(id, {
      onError: (e) =>
        toast.error({ title: 'Failed to update the default template', description: errorEnvelopeOf(e).message }),
    });
  };
  return (
    <Popover
      aria-label="Default insights template"
      placement="top end"
      padding={0}
      trigger={
        <AriaButton className={p.pickerButton} data-testid="default-template" style={{ maxWidth: 200 }}>
          {selected && <Icon icon="insightTemplate" size={16} />}
          <span className={p.pickerLabel}>{selected ? templateTitle(selected) : 'None'}</span>
          <Icon icon="chevronDown" size={16} />
        </AriaButton>
      }
    >
      {({ close }) => (
        <div className={p.picker} style={{ width: 260 }}>
          <input
            className={p.pickerSearch}
            placeholder="Search templates..."
            aria-label="Search templates"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={p.pickerList} role="radiogroup" aria-label="Templates">
            {list.length === 0 && <div className={p.pickerEmpty}>No results found</div>}
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === selectedId}
                className={p.pickerItem}
                data-testid="default-template-option"
                onClick={() => choose(t.id, close)}
              >
                <Icon icon="insightTemplate" size={16} />
                <span className={p.pickerLabel}>{templateTitle(t)}</span>
              </button>
            ))}
          </div>
          <div className={p.pickerFooter}>
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === null}
              className={p.pickerItem}
              style={{ width: '100%' }}
              data-testid="default-template-none"
              onClick={() => choose(null, close)}
            >
              None
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

export function CallIntelligencePage() {
  const entry = findSettingsEntry('call-intelligence');
  if (!entry) return null;
  return (
    <SettingsPage entry={entry}>
      <SettingsSection
        id="default-template"
        title="Default insights template"
        description="The selected template will be automatically applied to your meetings."
        aside={<DefaultTemplateSelect />}
      />
    </SettingsPage>
  );
}
