// The call page frame `/$ws/calls/$meetingId/$callRecordingId` (BACKLOG 10.12; I calls §3.1–3.3): header (breadcrumb,
// favourite, Share, menu, Ask AI), the title row, tabs (Transcript · Speakers · Meeting; Summary first below 800 px), the
// tab body (route outlet) and the Summary / Insights column at 40 % (resizable, min 435 px, persisted). Transcript-only:
// no player, no live-call states, no pin-to-screen.
import { Breadcrumbs, Button, Icon, IconButton, Popover, Tab, TabList, Tabs } from '@agentic-crm/ui';
import { Link, Outlet, useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpStatusOf } from '../../data/trpc';
import { usePersistentState } from '../../lib/storage';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AskButton, useAskContext } from '../ask';
import { HelpButton, PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import { openHelpDrawer } from '../shortcuts/helpStore';
import { CallFavoriteStar, CallMenu, type CallTab, callPath, copyText } from './actions';
import { CallPageContext } from './callContext';
import { useCall } from './data';
import * as s from './page.css';
import { SummaryColumn } from './SummaryColumn';

const NARROW_PX = 800;
const MIN_PANEL = 435;
const MAX_PANEL = 1000;
const WIDTH_KEY = 'call_summary_sidebar_panel_width';

/** Width of an element that mounts later (a callback ref): measured on mount and on every resize. */
function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number, T | null] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWidth(w);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width, node];
}

/** The clamped width of the summary column: default 40 % of the row, snapping back within 10 px of it. */
export function summaryWidth(stored: number | null, row: number): number {
  const max = Math.max(MIN_PANEL, Math.min(MAX_PANEL, row - MIN_PANEL));
  const preferred = stored ?? row * 0.4;
  return Math.round(Math.min(max, Math.max(MIN_PANEL, preferred)));
}

/** Share: our calls are visible to members with access to the meeting; external sharing is not built. */
function SharePopover({ call }: { call: { id: string; meetingId: string } }) {
  const { workspace } = useWorkspace();
  return (
    <Popover
      aria-label="Share"
      placement="bottom end"
      padding={0}
      trigger={
        <Button variant="ghost" size={28} data-testid="call-share">
          Share
        </Button>
      }
    >
      <div className={s.share} data-testid="share-popover">
        <div className={s.shareRow}>
          <span className={s.shareTile}>
            <Icon icon="people" size={16} />
          </span>
          <div className={s.shareTexts}>
            <span className={s.shareTitle}>Workspace access</span>
            <span className={s.shareSub}>Members who can see this meeting can open the call</span>
          </div>
          <Button
            variant="secondary"
            size={28}
            icon="link"
            onPress={() =>
              void copyText(`${window.location.origin}${callPath(workspace.slug, call.meetingId, call.id)}`)
            }
            data-testid="share-copy-link"
          >
            Copy link
          </Button>
        </div>
        <div className={s.shareRow}>
          <span className={s.shareTile}>
            <Icon icon="attrDomain" size={16} />
          </span>
          <div className={s.shareTexts}>
            <span className={s.shareTitle}>External access</span>
            <span className={s.shareSub}>Not shared with anyone outside the workspace</span>
          </div>
        </div>
        <div className={s.shareFooter}>External sharing is not available yet.</div>
      </div>
    </Popover>
  );
}

function TabLink({
  tab,
  label,
  icon,
  active,
}: {
  tab: CallTab;
  label: string;
  icon: 'summaryTab' | 'transcript' | 'people' | 'calendar';
  active: boolean;
}) {
  const { workspace } = useWorkspace();
  const { meetingId, callRecordingId } = useParams({ strict: false }) as { meetingId: string; callRecordingId: string };
  return (
    <Link
      to={callPath(workspace.slug, meetingId, callRecordingId, tab)}
      className={s.tab}
      role="tab"
      aria-selected={active}
      data-testid={`call-tab-${tab}`}
    >
      <Icon icon={icon} size={16} />
      {label}
    </Link>
  );
}

export function CallPage() {
  const { meetingId, callRecordingId } = useParams({ strict: false }) as { meetingId: string; callRecordingId: string };
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const call = useCall(callRecordingId);
  // The call is the page context of Ask AI: the header button and ⌘J open the chat with it attached.
  useAskContext({ call: { meetingId, callRecordingId } });
  useDocumentTitle(call.data?.title ?? 'Call');
  const [bodyRef, rowWidth, bodyEl] = useElementWidth<HTMLDivElement>();
  const narrow = rowWidth > 0 && rowWidth <= NARROW_PX;
  const [stored, setStored] = usePersistentState<number | null>(WIDTH_KEY, null);
  const [dragging, setDragging] = useState(false);
  const [focusSpeakerId, setFocusSpeakerId] = useState<string | null>(null);

  const tab = (location.pathname.split('/').filter(Boolean).pop() ?? 'transcript') as string;
  // `/summary` only exists for narrow pages: a wide page redirects to the transcript (I calls §1).
  useEffect(() => {
    if (tab === 'summary' && rowWidth > NARROW_PX && call.data)
      void navigate({ to: callPath(workspace.slug, meetingId, callRecordingId, 'transcript'), replace: true });
  }, [tab, rowWidth, call.data?.id]);

  const width = rowWidth > 0 ? summaryWidth(stored, rowWidth) : 0;
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      const row = bodyEl?.getBoundingClientRect();
      if (!row) return;
      e.preventDefault();
      setDragging(true);
      const move = (ev: PointerEvent) => {
        const next = row.right - ev.clientX;
        const preferred = row.width * 0.4;
        setStored(Math.abs(next - preferred) <= 10 ? null : Math.round(next));
      };
      const up = () => {
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [bodyEl, setStored],
  );

  const ctx = useMemo(
    () =>
      call.data
        ? { call: call.data, recordingId: callRecordingId, meetingId, narrow, focusSpeakerId, setFocusSpeakerId }
        : null,
    [call.data, callRecordingId, meetingId, narrow, focusSpeakerId],
  );

  const title = call.data?.title ?? (call.isError ? 'Not found' : '');
  const crumbs = [
    { id: 'calls', label: 'Calls', href: href('calls'), icon: <Icon icon="meeting" size={16} /> },
    { id: 'call', label: title },
  ];

  const header = (
    <PageHeader
      start={
        <div className={s.headerLeft}>
          <Breadcrumbs items={crumbs} />
          {call.data && <CallFavoriteStar recordingId={call.data.id} />}
        </div>
      }
      actions={
        <>
          {call.data && <SharePopover call={call.data} />}
          <span className={s.headerSpacer} />
          <IconButton
            icon="help"
            size={28}
            aria-label="Open help drawer"
            tooltip="Open help drawer"
            onPress={() => openHelpDrawer()}
          />
          {call.data ? (
            <CallMenu call={call.data} variant="page" onDeleted={() => void navigate({ to: href('calls') })} />
          ) : (
            <IconButton icon="moreVertical" size={28} aria-label="Call recording menu" isDisabled />
          )}
          <AskButton />
        </>
      }
    />
  );

  if (call.isError || (call.isPending && false)) {
    const missing = httpStatusOf(call.error) === 404;
    return (
      <>
        {header}
        <div className={s.page}>
          <div className={s.state} data-testid="call-unavailable">
            <Icon icon="lock" size={24} />
            <span className={s.stateTitle}>Call unavailable</span>
            <span className={s.stateText}>
              {missing
                ? "This call either doesn't exist or you don't have permission to view it"
                : 'The call could not be loaded. Try again in a moment.'}
            </span>
          </div>
        </div>
      </>
    );
  }
  if (!call.data || !ctx) {
    return (
      <>
        {header}
        <div className={s.page}>
          <div className={s.state} data-testid="call-loading">
            <span className={s.stateText}>Loading call...</span>
          </div>
        </div>
      </>
    );
  }

  const activeTab: CallTab = (
    ['summary', 'transcript', 'speakers', 'meeting'].includes(tab) ? tab : 'transcript'
  ) as CallTab;
  return (
    <CallPageContext.Provider value={ctx}>
      {header}
      <div className={s.page} data-testid="call-page" data-narrow={narrow || undefined}>
        <div className={s.titleRow}>
          <h1 className={s.title} data-testid="call-title">
            {call.data.title ?? 'Private call'}
          </h1>
        </div>
        <div ref={bodyRef} className={s.body}>
          <div className={s.main}>
            <div className={s.tabsBar}>
              <div className={s.tabs} role="tablist" aria-label="Call">
                {narrow && <TabLink tab="summary" label="Summary" icon="summaryTab" active={activeTab === 'summary'} />}
                <TabLink tab="transcript" label="Transcript" icon="transcript" active={activeTab === 'transcript'} />
                <TabLink tab="speakers" label="Speakers" icon="people" active={activeTab === 'speakers'} />
                <TabLink tab="meeting" label="Meeting" icon="calendar" active={activeTab === 'meeting'} />
              </div>
            </div>
            <div className={s.panel} data-testid="call-panel">
              {activeTab === 'summary' && narrow ? <SummaryColumn call={call.data} narrow /> : <Outlet />}
            </div>
          </div>
          {!narrow && width > 0 && (
            <div className={s.summaryColumn} style={{ width }} data-testid="summary-panel">
              <div
                className={s.resizeHandle}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the summary"
                data-dragging={dragging}
                data-testid="summary-resize"
                onPointerDown={startDrag}
                onDoubleClick={() => setStored(null)}
              />
              <div className={s.summaryScroll}>
                <SummaryColumn call={call.data} />
              </div>
            </div>
          )}
        </div>
      </div>
    </CallPageContext.Provider>
  );
}
