/** The colour a quote's state reads in */
export const quoteTone = (state: string) => (state === 'accepted' || state === 'invoiced' ? 'text-income' : state === 'expired' || state === 'declined' ? 'text-expense' : 'text-ink-600 dark:text-ink-300');
