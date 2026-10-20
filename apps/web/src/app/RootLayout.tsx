// Root of every page: client-side navigation for react-aria links, session wiring (401 → re-check, cross-tab
// sign-out), the signed-in user's mutation queue and realtime connection, the unload guard and the toaster.
import { Toaster } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import { activateAppQueue, appQueue } from '../data/mutations';
import { installUnloadGuard } from '../data/mutations/queue';
import { startRealtime } from '../data/realtime/connection';
import { installSessionHandling, meQuery } from '../data/session';
import { OfflineBanner } from '../features/shell/OfflineBanner';
import * as s from './root.css';

export function RootLayout() {
  const router = useRouter();
  const me = useQuery(meQuery());
  const userId = me.data?.user.id;

  useEffect(
    () =>
      installSessionHandling((origin) => {
        void router.navigate({ to: '/auth/sign-in', search: origin ? { origin } : {}, replace: true });
      }),
    [router],
  );

  useEffect(() => {
    if (!userId) return;
    activateAppQueue(userId);
    startRealtime();
  }, [userId]);

  useEffect(() => installUnloadGuard({ hasPending: () => appQueue().hasPending() }), []);

  return (
    // App hrefs are absolute paths already; react-aria links navigate through the router.
    <AriaRouterProvider navigate={(href) => void router.navigate({ href })}>
      <div className={s.frame}>
        <OfflineBanner />
        <div className={s.page}>
          <Outlet />
        </div>
      </div>
      <Toaster />
    </AriaRouterProvider>
  );
}
