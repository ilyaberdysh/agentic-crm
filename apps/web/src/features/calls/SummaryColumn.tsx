// The Summary and Insights column of the call page (I calls): the long
// summary, then the Insights section with the template picker and "Update". The same body is the Summary tab on a narrow
// page. States: "Analyzing call data..." while the summary or an insight is generating, a "not configured" notice when
// the workspace has no AI provider, and failures with a retry.
import { Button, Icon, Popover, Tooltip } from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf, httpStatusOf } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { readRaw, writeRaw } from '../../lib/storage';
import { useWorkspace } from '../shell/workspaceContext';
import { type CallDetail, type CallInsight, useGenerateInsight, useInsights, useInsightTemplates } from './data';
import { insightPhase, isNotConfiguredError, pickableTemplates, templateTitle } from './model';
import * as s from './page.css';

const NOT_CONFIGURED = 'AI is not configured for this workspace.';

function Analyzing({ label = 'Analyzing call data...' }: { label?: string }) {
  return (
    <p className={s.analyzing} data-testid="analyzing" role="status">
      {label}
    </p>
  );
}

function NotConfigured({ what }: { what: string }) {
  return (
    <p className={s.notice} data-testid="ai-not-configured" role="status">
      <Icon icon="info" size={16} className={s.noticeIcon} />
      <span>
        {what} are not available: {NOT_CONFIGURED}
      </span>
    </p>
  );
}

export function SummaryBlock({ call }: { call: CallDetail }) {
  if (call.summary) {
    return (
      <p className={s.summaryText} data-testid="call-summary">
        {call.summary}
      </p>
    );
  }
  const pending = call.status === 'processing' || call.summaryStatus === 'queued' || call.summaryStatus === 'executing';
  if (pending) return <Analyzing />;
  if (isNotConfiguredError(call.processingError)) return <NotConfigured what="Summaries" />;
  return (
    <p className={s.summaryText} data-testid="call-summary-empty">
      This call recording has no summary
    </p>
  );
}

// ---- insights ---------------------------------------------------------------------------------------------------------

const activeKey = (meetingId: string, recordingId: string) => `active-template:${meetingId}:${recordingId}`;

function InsightBody({ insight }: { insight: CallInsight }) {
  return (
    <div data-testid="insight-sections">
      {insight.sections.map((section) => {
        const nothing = section.type === 'list' ? section.items.length === 0 : !section.content?.trim();
        return (
          <section key={section.sectionId} className={s.insightSection} data-testid="insight-section">
            <h3 className={s.insightHeading}>{section.title}</h3>
            {nothing ? (
              <p className={s.insightNothing}>Nothing relevant mentioned</p>
            ) : section.type === 'list' ? (
              <ul className={s.insightList}>
                {section.items.map((item, i) => (
                  <li key={`${i}:${item}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className={s.insightText}>{section.content}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TemplatePicker({ selectedId, onPick }: { selectedId: string | null; onPick: (templateId: string) => void }) {
  const { href } = useWorkspace();
  const templates = useInsightTemplates({ enabledOnly: true });
  const [query, setQuery] = useState('');
  const list = pickableTemplates(templates.data ?? [], query);
  const selected = (templates.data ?? []).find((t) => t.id === selectedId);
  return (
    <Popover
      aria-label="Choose template"
      placement="bottom end"
      padding={0}
      trigger={
        <AriaButton className={s.pickerButton} data-testid="template-picker">
          {selected && <Icon icon="insightTemplate" size={16} />}
          <span className={s.pickerLabel}>{selected ? templateTitle(selected) : 'Choose template'}</span>
          <Icon icon="chevronDown" size={16} />
        </AriaButton>
      }
    >
      {({ close }) => (
        <div className={s.picker}>
          <input
            className={s.pickerSearch}
            placeholder="Search templates..."
            aria-label="Search templates"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={s.pickerList} role="radiogroup" aria-label="Templates">
            {list.length === 0 && <div className={s.pickerEmpty}>No results found</div>}
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === selectedId}
                className={s.pickerItem}
                data-testid="template-option"
                onClick={() => {
                  onPick(t.id);
                  close();
                }}
              >
                <Icon icon="insightTemplate" size={16} />
                <span className={s.pickerLabel}>{templateTitle(t)}</span>
              </button>
            ))}
          </div>
          <div className={s.pickerFooter}>
            <Link
              to={href('calls/templates')}
              className={s.pickerItem}
              style={{ textDecoration: 'none' }}
              onClick={close}
            >
              <Icon icon="settings" size={16} />
              Manage templates
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}

export function InsightsSection({ call }: { call: CallDetail }) {
  const recordingId = call.id;
  const insights = useInsights(recordingId);
  const generate = useGenerateInsight(recordingId);
  const [stored, setStored] = useState<string | null>(() => readRaw(activeKey(call.meetingId, recordingId)));
  const [genError, setGenError] = useState<string | null>(null);
  const selectedId = stored ?? call.defaultInsightTemplateId;
  const list = insights.data ?? [];
  const forTemplate = selectedId ? list.filter((i) => i.templateId === selectedId) : [];
  const active = forTemplate.find((i) => i.status !== 'failed') ?? forTemplate[0] ?? null;
  const terminal = active ? active.status === 'completed' || active.status === 'failed' : false;

  const start = (templateId: string) => {
    setGenError(null);
    generate.mutate(
      { templateId, insightId: newId() },
      {
        onError: (e) => {
          const env = errorEnvelopeOf(e);
          setGenError(
            env.code === 'AI_NOT_CONFIGURED' || httpStatusOf(e) === 503
              ? 'AI_NOT_CONFIGURED'
              : (env.message ?? 'Failed'),
          );
        },
      },
    );
  };

  const pick = (templateId: string) => {
    writeRaw(activeKey(call.meetingId, recordingId), templateId);
    setStored(templateId);
    autoStarted.current = templateId;
    const existing = list.find((i) => i.templateId === templateId && i.status !== 'failed');
    if (!existing) start(templateId);
    else setGenError(null);
  };

  // The member's default template (or one remembered for this call) is applied on open when the call has no insight for
  // it yet; a template that already has insights (even failed ones) is never started again by merely opening the call.
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || insights.isPending || call.status !== 'completed') return;
    if (autoStarted.current === selectedId) return;
    autoStarted.current = selectedId;
    if (!list.some((i) => i.templateId === selectedId)) start(selectedId);
  }, [selectedId, insights.isPending, call.status]);

  const phase = active ? insightPhase(active) : generate.isPending ? 'analyzing' : null;
  return (
    <div data-testid="insights">
      <div className={s.insightsHeader}>
        <h2 className={s.insightsHeaderTitle}>Insights</h2>
        {selectedId && terminal && (
          <Tooltip content="Regenerate insights with the latest version of this template">
            <Button
              variant="ghost"
              size={28}
              icon="refresh"
              className={s.updateButton}
              onPress={() => start(selectedId)}
              isPending={generate.isPending}
              data-testid="insight-update"
            >
              Update
            </Button>
          </Tooltip>
        )}
        <TemplatePicker selectedId={selectedId} onPick={pick} />
      </div>
      {active?.isOutdated && terminal && selectedId && (
        <div className={s.outdated} data-testid="insight-outdated">
          <span style={{ flex: 1 }}>A new version of this template is available</span>
          <Button variant="secondary" size={28} onPress={() => start(selectedId)} data-testid="insight-outdated-update">
            Update
          </Button>
        </div>
      )}
      {!selectedId ? (
        <div className={s.insightEmpty} data-testid="insights-empty">
          <span>No template selected for insights</span>
          <span>Gather valuable insights by selecting a template above</span>
        </div>
      ) : genError === 'AI_NOT_CONFIGURED' || phase === 'not-configured' ? (
        <NotConfigured what="Insights" />
      ) : genError ? (
        <p className={s.notice} role="alert">
          <Icon icon="warning" size={16} className={s.noticeIcon} />
          <span>Insights could not be generated. {genError}</span>
        </p>
      ) : phase === 'analyzing' || insights.isPending ? (
        <Analyzing />
      ) : phase === 'failed' ? (
        <p className={s.notice} role="alert" data-testid="insight-failed">
          <Icon icon="warning" size={16} className={s.noticeIcon} />
          <span>Insights could not be generated. Use Update to try again.</span>
        </p>
      ) : active ? (
        <InsightBody insight={active} />
      ) : null}
    </div>
  );
}

export function SummaryColumn({ call, narrow = false }: { call: CallDetail; narrow?: boolean }) {
  return (
    <div className={narrow ? s.summaryNarrow : undefined} data-testid="summary-column">
      <h2 className={s.sectionTitle}>Summary</h2>
      <SummaryBlock call={call} />
      <hr className={s.divider} />
      <InsightsSection call={call} />
    </div>
  );
}
