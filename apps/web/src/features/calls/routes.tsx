// Routes below `/$workspaceSlug/calls` (I calls §1):
//   calls                                       Calls list (`?query=`)
//   calls/calls · calls/$                        → calls
//   calls/templates                             Insight Templates list
//   calls/templates/$templateId                 template editor (full page)
//   calls/$meetingId/$callRecordingId           call page (`?start=&end=` highlights a range of the transcript)
//     / · /$                                    → transcript
//     /transcript · /speakers · /meeting          tabs
//     /summary                                  the Summary tab of a narrow page (a wide page redirects to the transcript)
//     /timeline                                 legacy → speakers
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { stringSearch } from '../../app/routeGuards';
import { CallPage } from './CallPage';
import { CallsPage } from './CallsPage';
import { MeetingTab } from './MeetingTab';
import { SpeakersTab } from './SpeakersTab';
import { TemplateEditorPage } from './TemplateEditorPage';
import { TemplatesPage } from './TemplatesPage';
import { TranscriptTab } from './TranscriptTab';

interface GuardContext {
  workspace: { slug: string } | null;
}

const slugOf = (context: unknown): string | null => (context as GuardContext).workspace?.slug ?? null;

function clean(search: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined));
}

function toCall(
  context: unknown,
  params: Record<string, string>,
  tab: string,
  search?: Record<string, unknown>,
): never {
  const slug = slugOf(context);
  const query =
    search && Object.keys(search).length > 0 ? `?${new URLSearchParams(search as Record<string, string>)}` : '';
  throw redirect({
    href: `/${slug}/calls/${params.meetingId}/${params.callRecordingId}/${tab}${query}`,
    replace: true,
  });
}

/** Seconds of a `?start=` / `?end=` as numbers (strings that parse), else dropped. */
function secondsSearch(search: Record<string, unknown>, key: string): number | undefined {
  const v = search[key];
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Pass the main route (`getParentRoute`). */
export function callsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const list = createRoute({
    getParentRoute,
    path: 'calls',
    validateSearch: (search: Record<string, unknown>) => ({ query: stringSearch(search, 'query') }),
    component: CallsPage,
  });
  const callsAlias = createRoute({
    getParentRoute,
    path: 'calls/calls',
    beforeLoad: ({ context }) => {
      const slug = slugOf(context);
      if (slug) throw redirect({ href: `/${slug}/calls`, replace: true });
    },
  });
  const templates = createRoute({ getParentRoute, path: 'calls/templates', component: TemplatesPage });
  const editor = createRoute({
    getParentRoute,
    path: 'calls/templates/$templateId',
    component: function TemplateEditorRoute() {
      return <TemplateEditorPage templateId={editor.useParams().templateId} />;
    },
  });
  /** `/calls/anything` → the list (a splat also matches `/calls` itself: it renders the list there). */
  const splat = createRoute({
    getParentRoute,
    path: 'calls/$',
    beforeLoad: ({ context, params }) => {
      const slug = slugOf(context);
      if (slug && (params as { _splat?: string })._splat) throw redirect({ href: `/${slug}/calls`, replace: true });
    },
    component: CallsPage,
  });

  const call = createRoute({
    getParentRoute,
    path: 'calls/$meetingId/$callRecordingId',
    validateSearch: (search: Record<string, unknown>) => ({
      start: secondsSearch(search, 'start'),
      end: secondsSearch(search, 'end'),
    }),
    component: CallPage,
  });
  const callIndex = createRoute({
    getParentRoute: () => call,
    path: '/',
    beforeLoad: ({ context, params, search }) =>
      toCall(context, params as Record<string, string>, 'transcript', clean(search)),
  });
  const callSplat = createRoute({
    getParentRoute: () => call,
    path: '$',
    beforeLoad: ({ context, params, search }) =>
      toCall(context, params as Record<string, string>, 'transcript', clean(search)),
  });
  const transcript = createRoute({ getParentRoute: () => call, path: 'transcript', component: TranscriptTab });
  const speakers = createRoute({ getParentRoute: () => call, path: 'speakers', component: SpeakersTab });
  const meeting = createRoute({ getParentRoute: () => call, path: 'meeting', component: MeetingTab });
  /** The call page itself draws the Summary column for this tab. */
  const summary = createRoute({ getParentRoute: () => call, path: 'summary', component: () => null });
  const timeline = createRoute({
    getParentRoute: () => call,
    path: 'timeline',
    beforeLoad: ({ context, params }) => toCall(context, params as Record<string, string>, 'speakers'),
  });

  return [
    list,
    callsAlias,
    templates,
    editor,
    splat,
    call.addChildren([callIndex, transcript, speakers, meeting, summary, timeline, callSplat]),
  ];
}
