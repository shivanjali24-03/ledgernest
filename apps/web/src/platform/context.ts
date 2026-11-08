import { createContext, useContext } from 'react';
import type { PlatformApi } from './types';

export const PlatformApiContext = createContext<PlatformApi | null>(null);

/** The console's data source: the real API when connected, sample data in demo mode. */
export function usePlatformApi(): PlatformApi {
  const api = useContext(PlatformApiContext);
  if (!api) throw new Error('usePlatformApi must be used inside <AuthProvider>');
  return api;
}
