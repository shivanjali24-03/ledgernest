import { lazy } from 'react';

// Pages load on demand, so the first screen downloads only what it needs
export const Dashboard = lazy(() => import('./Dashboard'));
export const SignIn = lazy(() => import('./SignIn'));
export const AcceptInvite = lazy(() => import('./AcceptInvite'));
export const PlatformOverview = lazy(() => import('../platform/pages/PlatformOverview'));
export const Organizations = lazy(() => import('../platform/pages/Organizations'));
export const OrganizationDetail = lazy(() => import('../platform/pages/OrganizationDetail'));
export const PlatformUsers = lazy(() => import('../platform/pages/PlatformUsers'));
export const Team = lazy(() => import('../team/pages/Team'));
export const ComingSoon = lazy(() => import('./ComingSoon'));
