/** Store Pulse as the app shows it (GET /pulse/status; also on each My Stores card). */
export interface PulseStatus {
  /** The store day, YYYY-MM-DD. */
  today: string;
  closedToday: boolean;
  openDrawers: number;
  openSince: string | null;
  lastSaleAt: string | null;
  /** True while today's weekday has fewer than three open days in the last six weeks. */
  learning: boolean;
  usual: { weekday: string; opensAt: string; closesAt: string | null } | null;
  alerts: { kind: string; severity: string; sentence: string; href: string; createdAt: string }[];
}

const storeDate = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const clock = (at: Date, timeZone: string, withDate: boolean) => new Intl.DateTimeFormat('en-US', {
  timeZone, hour: 'numeric', minute: '2-digit', ...(withDate ? { month: 'short', day: 'numeric' } : {}) }).format(at).replace(/\s+/g, ' ');

/** "just now", "4 minutes ago", "2 hours ago". */
export function ago(at: Date, now: number) {
  const minutes = Math.floor((now - at.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} ${hours === 1 ? 'hour' : 'hours'} ago` : `${Math.floor(hours / 24)} ${hours < 48 ? 'day' : 'days'} ago`;
}

/** One line for the store right now: an open alert first, else open since and the last sale, else who is (not) on. */
export function pulseLine(status: PulseStatus, timeZone: string, now = Date.now()): { text: string; tone: 'warning' | 'success' | 'muted' } {
  if (status.alerts.length) return { text: status.alerts[0].sentence, tone: 'warning' };
  if (status.openDrawers && status.openSince) {
    const since = new Date(status.openSince), sale = status.lastSaleAt ? new Date(status.lastSaleAt) : null;
    const opened = clock(since, timeZone, storeDate(since, timeZone) !== status.today);
    return { text: `Open since ${opened} · ${sale && sale >= since ? `last sale ${ago(sale, now)}` : 'no sale yet'}`, tone: 'success' };
  }
  if (status.closedToday) return { text: 'Closed today', tone: 'muted' };
  return { text: status.usual ? `Nobody is clocked in. On ${status.usual.weekday}s the store usually opens by ${status.usual.opensAt}.` : 'Nobody is clocked in.', tone: 'muted' };
}
