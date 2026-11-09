import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '../platform/errors';
import { scaleIn } from '../motion/tokens';
import Button from '../ui/Button';
import { Card } from '../ui/Kit';
import { useToast } from '../ui/toastContext';
import { readLogo } from './form';
import type { OrganizationSettings, SettingsApi } from './types';

/** Logo preview, upload (button or drag and drop) and removal. Files are checked before anything is sent. */
export default function LogoCard({ api, settings, canManage, queryKey }: { api: SettingsApi; settings: OrganizationSettings; canManage: boolean; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The image is fetched with the access token, then shown from an object URL
  const version = settings.logo?.updatedAt ?? 'none';
  const image = useQuery({ queryKey: [...queryKey, 'logo', version], queryFn: () => api.logo(), enabled: !!settings.logo });
  const url = useMemo(() => (image.data ? URL.createObjectURL(image.data) : null), [image.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const done = (message: string) => {
    toast(message);
    void queryClient.invalidateQueries({ queryKey });
  };
  const upload = useMutation({
    mutationFn: (file: { type: Parameters<SettingsApi['setLogo']>[0]['type']; data: string }) => api.setLogo(file),
    onSuccess: () => done(t('settings.logo.uploaded')),
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.removeLogo(),
    onSuccess: () => done(t('settings.logo.removed')),
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const r = await readLogo(file);
    if (!r.ok) {
      setProblem(t(`settings.logo.problems.${r.problem}`));
      return;
    }
    setProblem(null);
    upload.mutate({ type: r.type, data: r.data });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (canManage) void pick(e.dataTransfer.files[0]);
  };

  const shown = settings.logo && url;
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{t('settings.logo.title')}</h2>
      <p id={hintId} className="mt-1 text-sm text-ink-500">
        {t('settings.logo.hint')}
      </p>
      <div
        onDragOver={(e) => {
          if (!canManage) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          'mt-4 grid h-32 place-items-center lg:h-auto lg:aspect-[3/2] rounded-xl border-2 border-dashed p-4 transition-colors',
          dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-950/40',
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {shown ? (
            <motion.img key={url} variants={scaleIn} initial="hidden" animate="show" exit="exit" src={url} alt={t('settings.logo.alt', { name: settings.name })} className="max-h-full max-w-full object-contain" />
          ) : (
            <motion.div key="empty" variants={scaleIn} initial="hidden" animate="show" exit="exit" className="flex flex-col items-center gap-2 text-center text-sm text-ink-500">
              <ImageUp className="size-6 text-ink-400" aria-hidden />
              {settings.logo ? t('common.loading') : canManage ? t('settings.logo.drop') : t('settings.logo.none')}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-xs text-expense">
          {problem}
        </p>
      )}
      {canManage && (
        <div className="mt-4 flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
          <Button variant="secondary" size="sm" icon={<ImageUp className="size-4" />} loading={upload.isPending} aria-describedby={hintId} onClick={() => input.current?.click()}>
            {settings.logo ? t('settings.logo.replace') : t('settings.logo.upload')}
          </Button>
          {settings.logo && (
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('settings.logo.remove')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
