/** Calendar input values must use the store's day, regardless of register timezone. */
export const storeDateInput = (date: string | Date, timezone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(date));

export const displayStoreDate = (date: string | Date, timezone: string) => new Date(date).toLocaleDateString(undefined, { timeZone: timezone });
