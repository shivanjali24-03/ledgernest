/** "22 Sept 2025" in the user's language, for an ISO day */
export const dayLabel = (d: string, locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/** Today as an ISO day, for comparing slab dates */
export const todayIso = () => new Date().toISOString().slice(0, 10);
