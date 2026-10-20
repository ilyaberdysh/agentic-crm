// What the call page's tabs share: the loaded call, the layout mode (narrow pages get a Summary tab) and speaker focus
// mode (the Speakers tab turns it on; the Transcript tab dims the other speakers — it works without a player).
import { createContext, useContext } from 'react';
import type { CallDetail } from './data';

export interface CallPageContextValue {
  call: CallDetail;
  recordingId: string;
  meetingId: string;
  /** The page is narrower than 800 px: the Summary column is a tab. */
  narrow: boolean;
  focusSpeakerId: string | null;
  setFocusSpeakerId: (id: string | null) => void;
}

export const CallPageContext = createContext<CallPageContextValue | null>(null);

export function useCallPage(): CallPageContextValue {
  const value = useContext(CallPageContext);
  if (!value) throw new Error('useCallPage must be used inside the call page');
  return value;
}
