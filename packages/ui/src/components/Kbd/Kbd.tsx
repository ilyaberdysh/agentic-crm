import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from '../../icons/Icon';
import { cx } from '../../utils/cx';
import * as s from './Kbd.css';

export type KbdSize = 14 | 16 | 18 | 20;
export type KbdVariant = 'default' | 'tooltip' | 'on-accent' | 'negative';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /**
   * Keys of one shortcut, each rendered as its own cap. Named keys: `mod` (⌘ on Apple, Ctrl
   * elsewhere), `shift`, `alt`, `ctrl`, `enter` (icon), `tab`, `esc`, `backspace`, `up`,
   * `down`, `left`, `right`, `space`. Anything else renders as typed (single letters uppercased).
   */
  keys: string[];
  size?: KbdSize;
  variant?: KbdVariant;
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return true;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

const ICON_SIZE: Record<KbdSize, number> = { 14: 10, 16: 12, 18: 12, 20: 12 };

export function formatKey(key: string, apple = isApple()): string {
  switch (key.toLowerCase()) {
    case 'mod':
    case 'cmd':
    case 'meta':
      return apple ? '⌘' : 'Ctrl';
    case 'ctrl':
    case 'control':
      return apple ? '⌃' : 'Ctrl';
    case 'shift':
      return '⇧';
    case 'alt':
    case 'option':
      return apple ? '⌥' : 'Alt';
    case 'tab':
      return 'Tab';
    case 'esc':
    case 'escape':
      return 'ESC';
    case 'backspace':
      return '⌫';
    case 'delete':
      return 'Del';
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'left':
      return '←';
    case 'right':
      return '→';
    case 'space':
      return 'Space';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** Keyboard shortcut caps. `<Kbd keys={['mod', 'k']} />` */
export function Kbd({ keys, size = 16, variant = 'default', className, ...rest }: KbdProps) {
  const apple = isApple();
  return (
    <kbd className={cx(s.group, className)} {...rest}>
      {keys.map((key, i) => {
        let content: ReactNode = formatKey(key, apple);
        if (key.toLowerCase() === 'enter' || key.toLowerCase() === 'return') {
          content = <Icon icon="enter" size={ICON_SIZE[size]} label="Enter" />;
        }
        return (
          <span key={`${i}:${key}`} className={s.kbd({ size, variant })}>
            {content}
          </span>
        );
      })}
    </kbd>
  );
}
