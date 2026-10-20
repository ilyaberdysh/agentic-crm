import { ThemeProvider } from '@agentic-crm/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppRouter } from './app/router';
import { queryClient } from './data/queryClient';
import { configureRealtime } from './data/realtime/connection';
import { handleUnauthorized } from './data/session';

configureRealtime({ queryClient, onUnauthorized: () => void handleUnauthorized() });

const router = createAppRouter();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
