import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import './styles/index.css';
import './i18n';
import AppProviders from './AppProviders';
import { routes } from './routes';

// GitHub Pages sends deep links through 404.html as ?__path=… (see .github/pages/404.html); put the real address back.
// It is always joined to our own base path, so it can never point to another site.
const restored = new URLSearchParams(location.search).get('__path');
if (restored !== null) history.replaceState(null, '', import.meta.env.BASE_URL + restored.replace(/^\/+/, ''));

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
