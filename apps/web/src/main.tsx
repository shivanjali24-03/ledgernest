import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import './styles/index.css';
import './i18n';
import AppProviders from './AppProviders';
import { routes } from './routes';

const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user": honour the OS "reduce motion" setting everywhere */}
    <MotionConfig reducedMotion="user">
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </MotionConfig>
  </StrictMode>,
);
