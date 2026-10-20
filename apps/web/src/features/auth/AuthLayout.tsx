// Shared auth page shell ("AuthPage", K legacy-welcome §2): logo header, centred content, optional legal line,
// footer "© {year} {entity} · Privacy Policy · Support" with optional Sign out.

import { cx } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { signOut } from '../../data/session';
import { brand } from '../../lib/brand';
import * as s from './auth.css';
import { Wordmark } from './Wordmark';

export interface AuthLayoutProps {
  children: ReactNode;
  /** "By proceeding you acknowledge…" above the footer (sign-in pages). */
  legal?: boolean;
  /** Sign out in the footer (pages for signed-in users). */
  signOut?: boolean;
  /** 400 px column and 64 px section gaps (`/workspaces`). */
  wide?: boolean;
  /** Content is a status message (no access, errors) instead of a form column. */
  contentClassName?: string;
}

export function AuthLayout({ children, legal, signOut: showSignOut, wide, contentClassName }: AuthLayoutProps) {
  return (
    <main className={cx(s.page, wide && s.pageWide)}>
      <header className={s.header}>
        <Wordmark />
      </header>
      <div className={cx(s.content, wide && s.contentWide, contentClassName)}>{children}</div>
      {legal && (
        <p className={s.legal}>
          By proceeding you acknowledge that you have read, understood and agree to our{' '}
          <a className={s.link} href={brand.termsUrl} target="_blank" rel="noreferrer">
            Terms of Service.
          </a>
        </p>
      )}
      <AuthFooter signOut={showSignOut} />
    </main>
  );
}

export function AuthFooter({ signOut: showSignOut }: { signOut?: boolean }) {
  return (
    <footer className={s.footer}>
      <span>
        © {new Date().getFullYear()} {brand.legalEntity}
      </span>
      <a className={s.link} href={brand.privacyUrl} target="_blank" rel="noreferrer">
        Privacy Policy
      </a>
      <a className={s.link} href={brand.supportUrl} target="_blank" rel="noreferrer">
        Support
      </a>
      {showSignOut && (
        <button type="button" className={s.link} onClick={() => signOut()}>
          Sign out
        </button>
      )}
    </footer>
  );
}
