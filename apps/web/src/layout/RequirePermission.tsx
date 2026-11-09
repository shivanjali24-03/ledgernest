import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@ledgernest/shared';
import { Card, EmptyState } from '../ui/Kit';
import { useSession } from './session';

/** Shows the page only to people whose role allows it. The API checks again on every request. */
export default function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { t } = useTranslation();
  const session = useSession();
  if (session.permissions.has(permission)) return children;
  return (
    <Card>
      <EmptyState icon={<ShieldAlert className="size-5" />} title={t('common.noAccessTitle')} body={t('common.noAccessBody')} />
    </Card>
  );
}
