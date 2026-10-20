import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, Toaster } from '../../src';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <Toaster />
    </ThemeProvider>
  </StrictMode>,
);
