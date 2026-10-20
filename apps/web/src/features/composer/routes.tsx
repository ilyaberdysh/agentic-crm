// Routes of the Emails page ():
// /$ws/emails → /emails/drafts
// /$ws/emails/drafts|outbox|templates
// /$ws/messages → drafts, /$ws/message-templates → templates (legacy aliases)
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { EmailsPage, type EmailsTab } from './pages/EmailsPage';

/** Pass the main (`_main`) route. */
export function emailsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const to = (path: string) => (context: { workspace: { slug: string } | null }) => {
    if (!context.workspace) return;
    throw redirect({ href: `/${context.workspace.slug}/${path}`, replace: true });
  };
  const index = createRoute({
    getParentRoute,
    path: 'emails',
    beforeLoad: ({ context }) => to('emails/drafts')(context),
  });
  const tab = (name: EmailsTab) => {
    const route = createRoute({
      getParentRoute,
      path: `emails/${name}`,
      component: function EmailsTabRoute() {
        return <EmailsPage tab={name} />;
      },
    });
    return route;
  };
  const splat = createRoute({
    getParentRoute,
    path: 'emails/$',
    beforeLoad: ({ context }) => to('emails/drafts')(context),
  });
  const messages = createRoute({
    getParentRoute,
    path: 'messages',
    beforeLoad: ({ context }) => to('emails/drafts')(context),
  });
  const messageTemplates = createRoute({
    getParentRoute,
    path: 'message-templates',
    beforeLoad: ({ context }) => to('emails/templates')(context),
  });
  return [index, tab('drafts'), tab('outbox'), tab('templates'), splat, messages, messageTemplates];
}
