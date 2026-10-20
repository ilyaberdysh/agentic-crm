// The tab area element (position: relative, not scrolling): floating UI of a tab (bulk bars, drop overlays) renders
// into it so it stays put while the tab content scrolls.
import { createContext } from 'react';

export const TabAreaContext = createContext<HTMLElement | null>(null);
