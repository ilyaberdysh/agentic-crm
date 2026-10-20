// custom logo mark + wordmark (the logo is not reused). Occupies the 96 × 24 logo slot.
import { Link } from '@tanstack/react-router';
import { brand } from '../../lib/brand';
import * as s from './auth.css';

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={s.logoMark}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="currentColor" />
      <path
        d="M7.25 16.5 11 7.5h2l3.75 9M8.9 13h6.2"
        fill="none"
        stroke="var(--ar-logo-cut)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link to="/" aria-label={`${brand.name} logo`} className={s.wordmark}>
      <LogoMark />
      <span className={s.wordmarkText}>{brand.wordmark}</span>
    </Link>
  );
}
