import { lazy } from 'react';

// Pages load on demand, so the first screen downloads only what it needs
export const Dashboard = lazy(() => import('./Dashboard'));
export const SignIn = lazy(() => import('./SignIn'));
export const ComingSoon = lazy(() => import('./ComingSoon'));
