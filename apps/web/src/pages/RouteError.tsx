import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const RELOADED = 'ledgernest.chunkReload';

/** A page's code failed to load: after a new version is published, an open tab still asks for the old files */
const isStaleChunk = (e: unknown) => e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(e.message);

/**
 * When a page breaks: a plain explanation and a way on, instead of a stack trace. A page that failed to load because
 * a new version came out reloads once by itself, which fetches the new files.
 */
export default function RouteError({ inShell = false }: { inShell?: boolean }) {
  const { t } = useTranslation();
  const error = useRouteError();
  if (isStaleChunk(error)) {
    let tried = false;
    try {
      tried = sessionStorage.getItem(RELOADED) === location.pathname;
      sessionStorage.setItem(RELOADED, location.pathname);
    } catch {
      /* storage blocked: reload anyway, once per visit is the best we can do */
    }
    if (!tried) {
      location.reload();
      return null;
    }
  }
  const status = isRouteErrorResponse(error) ? error.status : null;
  return (
    <div className={inShell ? 'grid min-h-[60vh] place-items-center p-6 text-center' : 'grid min-h-dvh place-items-center p-6 text-center'} role="alert">
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="size-7" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-tight">{status === 404 ? t('errors.page.notFoundTitle') : t('errors.page.title')}</h1>
        <p className="mt-2 text-sm text-ink-500">{status === 404 ? t('errors.page.notFoundBody') : isStaleChunk(error) ? t('errors.page.newVersion') : t('errors.page.body')}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => location.reload()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
            <RotateCw className="size-4" aria-hidden /> {t('errors.page.reload')}
          </button>
          <Link to="/" className="inline-flex h-10 items-center rounded-xl border border-ink-200 px-4 text-sm font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800">
            {t('errors.page.home')}
          </Link>
        </div>
        {import.meta.env.DEV && error instanceof Error && (
          <details className="mt-6 text-start text-xs text-ink-500">
            <summary>{error.message}</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap">{error.stack}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
