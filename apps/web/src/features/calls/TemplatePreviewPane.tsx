// The preview pane of the template editor:
// calls-template-preview-generated.png): "Previewing [call] ▾" with the 10 most recent completed calls, "Generate preview",
// the generating state, and the sections of the preview as the call page renders them.
import { Button, Icon, IconButton, Popover, Tooltip } from '@agentic-crm/ui';
import { useMemo, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf, httpStatusOf } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useCalendar } from '../tasks/calendar';
import { type InsightTemplateDetail, useCallsList, useGeneratePreview } from './data';
import { formatCallDuration, formatTimeRange, insightPhase, isNotConfiguredError } from './model';
import * as p from './page.css';
import * as s from './templates.css';

export interface PreviewIssueHandler {
  /** The server refused: sections missing a title or prompt. */
  (issues: Array<{ sectionId: string; section: number; missing: string[] }>, action: 'preview'): void;
}

function PreviewSections({ sections }: { sections: InsightTemplateDetail['previews'][number]['sections'] }) {
  return (
    <div data-testid="preview-sections">
      {sections.map((section) => {
        const nothing = section.type === 'list' ? section.items.length === 0 : !section.content?.trim();
        return (
          <section key={section.sectionId} className={p.insightSection} data-testid="preview-section">
            <h3 className={p.insightHeading} style={{ marginTop: 16 }}>
              {section.title}
            </h3>
            {nothing ? (
              <p className={p.insightNothing}>Nothing relevant mentioned</p>
            ) : section.type === 'list' ? (
              <ul className={p.insightList}>
                {section.items.map((item, i) => (
                  <li key={`${i}:${item}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className={p.insightText}>{section.content}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function TemplatePreviewPane({
  template,
  onIncomplete,
  beforeGenerate,
}: {
  template: InsightTemplateDetail;
  onIncomplete: PreviewIssueHandler;
  /** Awaited before a preview is requested (pending edits are stored first). */
  beforeGenerate?: () => Promise<void>;
}) {
  const { timeZone } = useCalendar();
  const calls = useCallsList({
    filters: [{ field: 'status', mode: 'must', operator: 'eq', value: 'completed' }],
    sort: { field: 'meeting-start-at', direction: 'desc' },
    groupBy: 'none',
    limit: 10,
  });
  const generate = useGeneratePreview();
  const [error, setError] = useState<string | null>(null);
  const items = calls.data?.items ?? [];
  const newest = template.previews[0];
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = picked ?? newest?.recordingId ?? items[0]?.id ?? null;
  const selected = items.find((c) => c.id === selectedId) ?? null;
  const preview = useMemo(
    () => template.previews.find((pv) => pv.recordingId === selectedId) ?? null,
    [template.previews, selectedId],
  );
  const phase = preview ? insightPhase(preview) : null;

  const run = async (recordingId: string) => {
    setError(null);
    await beforeGenerate?.();
    generate.mutate(
      { templateId: template.id, recordingId, previewId: newId() },
      {
        onError: (e) => {
          const issues = (e as { shape?: { additional_information?: { code?: string; issues?: unknown } } }).shape
            ?.additional_information;
          if (issues?.code === 'TEMPLATE_INCOMPLETE')
            onIncomplete(
              Array.isArray(issues.issues)
                ? (issues.issues as Array<{ sectionId: string; section: number; missing: string[] }>)
                : [],
              'preview',
            );
          else if (errorEnvelopeOf(e).code === 'AI_NOT_CONFIGURED' || httpStatusOf(e) === 503)
            setError('AI_NOT_CONFIGURED');
          else setError(errorEnvelopeOf(e).message ?? 'Failed to generate the preview');
        },
      },
    );
  };

  const stale = preview?.isStale ?? false;
  return (
    <div className={s.previewPane} data-testid="template-preview">
      {items.length === 0 && !calls.isPending ? (
        <div className={s.previewBar}>
          No recordings available for preview
          <Tooltip content="Once you have recorded calls you can use them to preview your template content">
            <Icon icon="info" size={14} />
          </Tooltip>
        </div>
      ) : (
        <div className={s.previewBar}>
          <span>Previewing</span>
          <Popover
            aria-label="Choose a call to preview"
            placement="bottom start"
            padding={0}
            trigger={
              <AriaButton className={s.sourceButton} data-testid="preview-source">
                <Icon icon="calendar" size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected?.title ?? 'Choose a call'}
                </span>
                <Icon icon="chevronDown" size={14} />
              </AriaButton>
            }
          >
            {({ close }) => (
              <div className={s.sourceList} role="radiogroup" aria-label="Calls">
                {items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={c.id === selectedId}
                    className={s.sourceOption}
                    data-testid="preview-source-option"
                    onClick={() => {
                      setPicked(c.id);
                      // Selecting another call generates its preview when there is none yet.
                      if (!template.previews.some((pv) => pv.recordingId === c.id)) run(c.id);
                      close();
                    }}
                  >
                    <Icon icon="calendar" size={16} />
                    <span className={s.sourceTexts}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title ?? 'Private call'}
                      </span>
                      <span className={s.sourceSub}>
                        {formatTimeRange(c.startAt, c.endAt, timeZone)} • {formatCallDuration(c.durationSeconds)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Popover>
          {stale && selectedId && (
            <IconButton
              icon="refresh"
              size={20}
              aria-label="Regenerate insights with the latest version of this template"
              tooltip="Regenerate insights with the latest version of this template"
              onPress={() => run(selectedId)}
              data-testid="preview-refresh"
            />
          )}
        </div>
      )}
      {error === 'AI_NOT_CONFIGURED' ||
      (preview && phase === 'not-configured') ||
      isNotConfiguredError(preview?.error) ? (
        <div className={s.previewCenter} data-testid="preview-not-configured">
          <span>Previews are not available: AI is not configured for this workspace.</span>
        </div>
      ) : error ? (
        <div className={s.previewCenter} role="alert">
          <span>{error}</span>
        </div>
      ) : preview && (phase === 'analyzing' || generate.isPending) ? (
        <div className={s.previewBody}>
          <h3 className={s.previewHeading}>Insights</h3>
          <p className={p.analyzing} data-testid="preview-analyzing" role="status">
            Analyzing call data...
          </p>
        </div>
      ) : preview && phase === 'ready' ? (
        <div className={s.previewBody}>
          <h3 className={s.previewHeading}>Insights</h3>
          <PreviewSections sections={preview.sections} />
        </div>
      ) : preview && phase === 'failed' ? (
        <div className={s.previewCenter} role="alert">
          <span>The preview could not be generated.</span>
          {selectedId && (
            <Button variant="secondary" size={28} icon="refresh" onPress={() => run(selectedId)}>
              Generate preview
            </Button>
          )}
        </div>
      ) : (
        <div className={s.previewCenter} data-testid="preview-empty">
          <span className={s.previewHeading}>Preview your call insights</span>
          <span>Generate a preview to see your call insights in action</span>
          {selectedId && (
            <Button
              variant="secondary"
              size={28}
              icon="refresh"
              isPending={generate.isPending}
              onPress={() => run(selectedId)}
              data-testid="preview-generate"
            >
              Generate preview
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
