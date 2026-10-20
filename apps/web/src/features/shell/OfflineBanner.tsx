// Offline banner (system-ui §5; evidence/B/banner-offline.png): orange full-width bar above the app while the
// realtime connection is lost or the browser is offline. "You're offline." then "You've been offline for {duration}."
// (updates every second) + "Please check your internet connection and <retry>." — retry skips the reconnect backoff.
import { AnnouncementBanner } from '@agentic-crm/ui';
import { useEffect, useState } from 'react';
import { reconnectNow, useConnectionState } from '../../data/realtime/connection';

/** Don't flash the banner for blips shorter than this (Attio confirms twice, 500 ms apart). */
const GRACE_MS = 1000;

export function formatOfflineDuration(ms: number): string | null {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return null;
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function OfflineBanner() {
  const { offlineSince, browserOffline } = useConnectionState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (offlineSince === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [offlineSince]);

  if (offlineSince === null) return null;
  const elapsed = now - offlineSince;
  if (!browserOffline && elapsed < GRACE_MS) return null;
  const duration = formatOfflineDuration(elapsed);

  return (
    <AnnouncementBanner scheme="orange">
      {duration ? `You've been offline for ${duration}.` : "You're offline."} Please check your internet connection and{' '}
      <button type="button" onClick={reconnectNow}>
        retry
      </button>
      .
    </AnnouncementBanner>
  );
}
