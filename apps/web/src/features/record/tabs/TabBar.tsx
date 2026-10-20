// Record tab bar (D README §2.4; components.md Tabs): Overview, a divider, then the layout's tabs with count badges
// (Notes, open Tasks, related records; Emails "-" without sources). Tabs that do not fit collapse into "+N more ⌄".
// ⌥← / ⌥→ move through the tabs, wrapping around (D §3.11).
import { Icon, type IconName, Menu, MenuItem, MenuTrigger } from '@agentic-crm/ui';
import { type MouseEvent, useLayoutEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useAttributeValues } from '../../attributes';
import { useAction } from '../../shortcuts/catalog';
import { useRecordCallCount, useRecordThreadPreview } from '../adapters';
import { useRecordPage } from '../context';
import { useRelatedCounts } from '../data';
import { adjacentTab, pathHead, type ResolvedTab, type TabKind } from '../layout/model';
import * as s from '../record.css';

export const TAB_ICON: Record<TabKind, IconName> = {
  overview: 'overview',
  activity: 'activity',
  agent: 'bot',
  emails: 'emails',
  calls: 'meeting',
  notes: 'noteTab',
  tasks: 'tasks',
  files: 'fileTab',
  relationship: 'relationship',
};

const MORE_WIDTH = 96;
const DIVIDER_WIDTH = 17;
const GAP = 4;

export function TabBar() {
  const { layout, activeTab, goToTab, basePath } = useRecordPage();
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(layout.tabs.length);
  const key = layout.allTabs.map((t) => `${t.slug}:${t.title}`).join('|');

  useAction('next-tab', () => {
    const next = adjacentTab(layout, activeTab, 1);
    if (next) goToTab(next.slug);
  });
  useAction('previous-tab', () => {
    const prev = adjacentTab(layout, activeTab, -1);
    if (prev) goToTab(prev.slug);
  });

  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;
    const fit = () => {
      const widths = [...measure.children].map((c) => (c as HTMLElement).offsetWidth);
      const [overviewWidth = 0, ...tabWidths] = widths;
      const available = bar.clientWidth - 24;
      const base = (layout.overview ? overviewWidth + DIVIDER_WIDTH : 0) + 2;
      const all = tabWidths.reduce((a, b) => a + b + GAP, 0);
      if (base + all <= available) {
        setVisible(tabWidths.length);
        return;
      }
      let used = base + MORE_WIDTH;
      let k = 0;
      while (k < tabWidths.length && used + (tabWidths[k] as number) + GAP <= available) {
        used += (tabWidths[k] as number) + GAP;
        k++;
      }
      setVisible(k);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [key, layout.overview]);

  const shown = layout.tabs.slice(0, visible);
  const hidden = layout.tabs.slice(visible);
  const link = (tab: ResolvedTab) => `${basePath}/${tab.slug}`;
  const onClick = (tab: ResolvedTab) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    goToTab(tab.slug);
  };

  return (
    <div className={s.tabBar} ref={barRef} data-testid="record-tabs">
      <div className={s.tabMeasure} ref={measureRef} aria-hidden="true">
        {layout.allTabs.map((t) => (
          <span key={t.element.elementId} className={s.tab}>
            <TabInner tab={t} />
          </span>
        ))}
      </div>
      <div className={s.tabList} role="tablist" aria-label="Record tabs">
        {layout.overview && (
          <>
            <a
              href={link(layout.overview)}
              className={s.tab}
              role="tab"
              aria-selected={activeTab === layout.overview.slug}
              data-active={activeTab === layout.overview.slug || undefined}
              onClick={onClick(layout.overview)}
            >
              <TabInner tab={layout.overview} />
            </a>
            <span className={s.tabDivider} aria-hidden="true" />
          </>
        )}
        {shown.map((t) => (
          <a
            key={t.element.elementId}
            href={link(t)}
            className={s.tab}
            role="tab"
            aria-selected={activeTab === t.slug}
            data-active={activeTab === t.slug || undefined}
            data-tab={t.slug}
            onClick={onClick(t)}
          >
            <TabInner tab={t} />
          </a>
        ))}
        {hidden.length > 0 && (
          <MenuTrigger>
            <AriaButton
              className={s.tab}
              data-active={hidden.some((t) => t.slug === activeTab) || undefined}
              aria-label={`${hidden.length} more tabs`}
            >
              +{hidden.length} more
              <Icon icon="chevronDown" size={16} />
            </AriaButton>
            <Menu aria-label="More tabs" placement="bottom end" width={250} onAction={(k) => goToTab(String(k))}>
              {hidden.map((t) => (
                <MenuItem key={t.slug} id={t.slug} icon={TAB_ICON[t.kind]}>
                  {t.title}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        )}
      </div>
    </div>
  );
}

function TabInner({ tab }: { tab: ResolvedTab }) {
  return (
    <>
      <Icon icon={TAB_ICON[tab.kind]} size={16} className={s.tabIcon} />
      {tab.title}
      <TabCount tab={tab} />
    </>
  );
}

function TabCount({ tab }: { tab: ResolvedTab }) {
  switch (tab.kind) {
    case 'notes':
    case 'tasks':
      return <ChildCount kind={tab.kind} />;
    case 'emails':
      return <EmailsCount hasSources={tab.children.length > 0} />;
    case 'calls':
      return <CallsCount />;
    case 'relationship':
      return <RelationshipCount tab={tab} />;
    default:
      return null;
  }
}

/** Calls of the record (meetings linked to it or with its people), "99+" when more. */
function CallsCount() {
  const { recordRef } = useRecordPage();
  const count = useRecordCallCount(recordRef);
  if (count === null) return null;
  return <span className={s.tabCount}>{formatCount(count)}</span>;
}

/** Threads the viewer can see on the record, "99+" when more, "-" for a tab without sources (D §2.5a). */
function EmailsCount({ hasSources }: { hasSources: boolean }) {
  const { recordRef } = useRecordPage();
  const threads = useRecordThreadPreview(recordRef, 1, hasSources);
  if (!hasSources) return <span className={s.tabCount}>-</span>;
  if (!threads.data) return null;
  return <span className={s.tabCount}>{formatCount(threads.data.total)}</span>;
}

function ChildCount({ kind }: { kind: 'notes' | 'tasks' }) {
  const { recordRef } = useRecordPage();
  const counts = useRelatedCounts(recordRef);
  if (!counts.data) return null;
  return (
    <span className={s.tabCount}>{formatCount(kind === 'notes' ? counts.data.notes : counts.data.openTasks)}</span>
  );
}

function RelationshipCount({ tab }: { tab: ResolvedTab }) {
  const { recordRef, attributes } = useRecordPage();
  const attribute = attributes.find((a) => a.id === pathHead(tab.element.path));
  if (!attribute) return null;
  return <RelationshipCountOf attributeId={attribute.id} recordRef={recordRef} />;
}

function RelationshipCountOf({
  attributeId,
  recordRef,
}: {
  attributeId: string;
  recordRef: { entityDefinitionId: string; entityInstanceId: string };
}) {
  const { attributes } = useRecordPage();
  const attribute = attributes.find((a) => a.id === attributeId) as NonNullable<(typeof attributes)[number]>;
  const { values, isLoading } = useAttributeValues(recordRef, attribute);
  if (isLoading) return null;
  return <span className={s.tabCount}>{formatCount(values.length)}</span>;
}

/** Tab counts cap at "99+" (D §2.5a). */
export function formatCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}
