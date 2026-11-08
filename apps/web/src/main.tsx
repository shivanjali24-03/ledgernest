import { StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import './styles/index.css';
import './i18n';
import AppShell from './layout/AppShell';
import SessionProvider from './layout/SessionProvider';
import { NAV } from './layout/nav';
import { ComingSoon, Dashboard } from './pages';

const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: page(<Dashboard />) },
        ...NAV.flatMap((g) => g.items)
          .filter((i) => i.to !== '/')
          .map((i) => ({ path: i.to.slice(1), element: page(<ComingSoon />) })),
        { path: '*', element: page(<ComingSoon />) },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user": honour the OS "reduce motion" setting everywhere */}
    <MotionConfig reducedMotion="user">
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </MotionConfig>
  </StrictMode>,
);
