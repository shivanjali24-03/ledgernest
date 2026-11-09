import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';

const REASONS = ['own_request', 'already_decided', 'document_changed', 'document_gone', 'not_yours'];

/** Whether posting was held for approval rather than refused */
export const heldForApproval = (e: unknown) => e instanceof ApiError && (e.details?.reason === 'approval_required' || e.details?.reason === 'approval_pending');
/** The message for a held document: sent, or already waiting */
export const heldMessage = (e: unknown, t: TFunction) => t(e instanceof ApiError && e.details?.reason === 'approval_pending' ? 'approvals.alreadyWaiting' : 'approvals.sent');

/** A translated explanation for an approval refusal. */
export function approvalErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (typeof reason === 'string' && REASONS.includes(reason)) return t(`approvals.errors.${reason}`);
  if (e instanceof ApiError && e.status === 403) return t('approvals.errors.forbidden');
  return t('approvals.errors.generic');
}
