import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';

/** A translated message for a failed console action. Never shows the server's English. */
export function apiErrorMessage(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    const reason = e.details?.reason;
    if (reason === 'last_super_admin') return t('platform.errors.lastSuperAdmin');
    if (reason === 'self') return t('platform.errors.self');
    if (reason === 'inactive') return t('platform.errors.inactive');
    switch (e.kind) {
      case 'forbidden':
        return t('platform.errors.forbidden');
      case 'not_found':
        return t('platform.errors.notFound');
      case 'conflict':
        return t('platform.errors.conflict');
      case 'network':
        return t('auth.errors.network');
      case 'session_expired':
        return t('auth.errors.expired');
      default:
        break;
    }
  }
  return t('auth.errors.server');
}
