import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

const REASONS = ['code_taken', 'name_taken', 'parent_type', 'too_deep', 'cycle', 'has_children', 'has_active_children', 'has_entries', 'subtype', 'system', 'parent_archived', 'parent_not_found', 'already_archived', 'not_archived', 'chart_not_empty'];

/** A translated explanation for an account refusal, falling back to the general messages. */
export function accountErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (typeof reason === 'string' && REASONS.includes(reason)) return t(`accounts.errors.${reason}`, { max: e instanceof ApiError ? e.details?.max : undefined });
  return apiErrorMessage(e, t);
}

/** Which form field a refusal is about, so it can be shown next to it. */
export const errorField = (e: unknown): 'code' | 'name' | 'parentId' | 'subtype' | null => {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (reason === 'code_taken') return 'code';
  if (reason === 'name_taken') return 'name';
  if (reason === 'parent_type' || reason === 'too_deep' || reason === 'cycle' || reason === 'parent_archived' || reason === 'parent_not_found') return 'parentId';
  if (reason === 'subtype') return 'subtype';
  return null;
};
