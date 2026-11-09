import type { ApprovalDocument, ApprovalStatus } from '@ledgernest/shared';

export interface ApprovalRule {
  documentType: ApprovalDocument;
  enabled: boolean;
  /** In the base currency's smallest unit */
  minAmount: number | null;
}
export interface ApprovalRequest {
  id: string;
  documentType: ApprovalDocument;
  /** The journal entry or bill held; a held payment's once approved */
  documentId: string | null;
  amount: number;
  summary: string;
  status: ApprovalStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  requestedBy: { name: string; email: string };
  decidedBy: { name: string; email: string } | null;
  /** A held payment as it was entered */
  payment: { date: string; reference: string | null } | null;
}

/** Approval rules and requests. Live and demo both implement it. */
export interface ApprovalsApi {
  rules(): Promise<ApprovalRule[]>;
  setRule(documentType: ApprovalDocument, minAmount: number): Promise<ApprovalRule[]>;
  removeRule(documentType: ApprovalDocument): Promise<ApprovalRule[]>;
  list(status?: ApprovalStatus): Promise<{ items: ApprovalRequest[]; pending: number }>;
  approve(id: string, note?: string): Promise<ApprovalRequest>;
  reject(id: string, note: string): Promise<ApprovalRequest>;
  cancel(id: string): Promise<void>;
}
