import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

/** A translated message for a refused team action. */
export function teamErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  switch (reason) {
    case 'exceeds_your_access':
      return t('team.errors.exceeds');
    case 'last_owner':
      return t('team.errors.lastOwner');
    case 'self':
      return t('team.errors.self');
    case 'already_member':
      return t('team.errors.alreadyMember');
    case 'already_invited':
      return t('team.errors.alreadyInvited');
    case 'name_taken':
      return t('team.errors.nameTaken');
    case 'in_use':
      return t('team.errors.inUse');
    default:
      return apiErrorMessage(e, t);
  }
}
