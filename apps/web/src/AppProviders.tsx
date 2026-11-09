import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import AuthProvider from './auth/AuthProvider';
import type { AuthClient } from './auth/client';
import { createQueryClient } from './lib/queryClient';
import type { PlatformApi } from './platform/types';
import ToastProvider from './ui/ToastProvider';

/** Everything the app needs around the router. `client` overrides the API client (tests, demo). */
export default function AppProviders({ children, client, platformApi }: { children: ReactNode; client?: AuthClient | null; platformApi?: PlatformApi }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{client === undefined ? (
          <AuthProvider platformApi={platformApi}>{children}</AuthProvider>
        ) : (
          <AuthProvider client={client} platformApi={platformApi}>
            {children}
          </AuthProvider>
        )}</ToastProvider>
    </QueryClientProvider>
  );
}
