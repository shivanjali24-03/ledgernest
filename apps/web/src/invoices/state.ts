/** The colour an invoice's state reads in */
export const stateTone = (state: string) => (state === 'paid' ? 'text-income' : state === 'overdue' ? 'text-expense' : state === 'void' ? 'text-ink-400' : 'text-ink-600 dark:text-ink-300');
