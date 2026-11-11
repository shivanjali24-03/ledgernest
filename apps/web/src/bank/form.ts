/** A bank account as typed: every field a string, blank when not given */
export type BankForm = { accountName: string; accountNumber: string; ifsc: string; bankName: string; branch: string };
export const emptyBank: BankForm = { accountName: '', accountNumber: '', ifsc: '', bankName: '', branch: '' };
export const bankForm = (b: { accountName: string; accountNumber: string; ifsc: string; bankName: string | null; branch: string | null } | null | undefined): BankForm =>
  b ? { accountName: b.accountName, accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName ?? '', branch: b.branch ?? '' } : emptyBank;
/** What to send: null when nothing was typed */
export const bankValue = (f: BankForm) => (Object.values(f).some((x) => x.trim()) ? { accountName: f.accountName, accountNumber: f.accountNumber, ifsc: f.ifsc, bankName: f.bankName || null, branch: f.branch || null } : null);
