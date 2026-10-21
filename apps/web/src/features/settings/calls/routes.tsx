// Settings → Call intelligence (`/$ws/settings/call-intelligence`). The legacy `call-recording` path redirects.
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { CallIntelligencePage } from './CallIntelligencePage';

interface GuardContext {
  workspace: { slug: string } | null;
}

function toPage(context: unknown): void {
  const slug = (context as GuardContext).workspace?.slug;
  if (slug) throw redirect({ href: `/${slug}/settings/call-intelligence`, replace: true });
}

/** Pass the settings route (`getParentRoute`). */
export function callSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const page = createRoute({ getParentRoute, path: 'call-intelligence', component: CallIntelligencePage });
  // A splat also matches `call-intelligence` itself: it renders the page there and redirects anything below it.
  const splat = createRoute({
    getParentRoute,
    path: 'call-intelligence/$',
    component: CallIntelligencePage,
    beforeLoad: ({ context, params }) => {
      if ((params as { _splat?: string })._splat) toPage(context);
    },
  });
  const legacy = createRoute({
    getParentRoute,
    path: 'call-recording',
    beforeLoad: ({ context }) => toPage(context),
  });
  return [page, splat, legacy];
}
