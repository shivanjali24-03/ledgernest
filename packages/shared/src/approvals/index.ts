import { z } from 'zod';
import { MAX_LINE_AMOUNT } from '../journals/index.js';

/**
 * Approvals: a second pair of eyes before money moves. A rule says that journal entries, bills or vendor
 * payments at or above an amount (in the base currency) need an approver's yes. Posting one holds it as a
 * pending request instead; approving posts it, sending it back leaves it as it was, with a note.
 */
export const APPROVAL_DOCUMENTS = ['journal', 'bill', 'payment'] as const;
export type ApprovalDocument = (typeof APPROVAL_DOCUMENTS)[number];
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const approvalRuleSchema = z.object({
  /** At or above this, in the base currency's smallest unit; 0 = every one */
  minAmount: z.number().int().min(0).max(MAX_LINE_AMOUNT),
});
export const approvalDecisionSchema = z.object({ note: z.string().trim().max(500).optional() });
export const approvalRejectSchema = z.object({ note: z.string().trim().min(3, 'Say what needs to change.').max(500) });
export const approvalListQuerySchema = z.object({ status: z.enum(APPROVAL_STATUSES).optional() });

/** Whether a rule holds a document of this amount */
export const needsApproval = (rule: { minAmount: number } | null | undefined, amount: number) => !!rule && amount >= rule.minAmount;
