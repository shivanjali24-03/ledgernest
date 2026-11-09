import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../auth/client';

/** Retries only failures that might go away (network, server); never 4xx answers. */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.kind === 'network' || error.kind === 'server'),
      },
      mutations: { retry: false },
    },
  });
