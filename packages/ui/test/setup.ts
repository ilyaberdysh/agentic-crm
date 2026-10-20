import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.body.removeAttribute('style');
  window.localStorage.clear();
});
