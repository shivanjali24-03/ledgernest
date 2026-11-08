import { createContext } from 'react';
import type { AuthClient } from './client';

/** The live API client, or null in demo mode. */
export const ApiClientContext = createContext<AuthClient | null>(null);
