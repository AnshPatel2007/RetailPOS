import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { MessageCircle, Send, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useEffectiveLocation } from '../../hooks/useEffectiveLocation';
import { sessionGeneration } from '../../services/sessionGeneration';
import { api } from '../../services/api';
import { Button } from '../ui/Button';

interface Turn { role: 'user' | 'assistant'; content: string }

function pageContext(path: string): string {
  if (path === '/login') return 'sign-in';
  if (path === '/reset-password') return 'password-reset';
  if (path === '/customer-display') return 'customer-display';
  if (path === '/pos') return 'checkout';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/insights') || path === '/analytics') return 'reports';
  if (path.includes('/stock-control')) return 'stock-control';
  if (path.includes('/purchasing')) return 'purchasing';
  if (path.startsWith('/team-time') || path === '/my-shift') return 'team';
  if (path === '/inventory') return 'products';
  if (path.startsWith('/customers')) return 'customers';
  if (path.startsWith('/financial')) return 'financial';
  if (path === '/settings/jobs') return 'jobs';
  if (path.startsWith('/settings')) return 'settings';
  if (path === '/audit-log') return 'activity';
  return ['dashboard', 'lottery', 'promotions'].includes(path.slice(1)) ? path.slice(1) : 'general';
}

/** The only context sent automatically is this finite section name, never URL queries or page contents. */
function boundedHistory(turns: Turn[]): Turn[] {
  const result: Turn[] = [];
  let remaining = 20000;
  for (const turn of turns.slice(-10).reverse()) {
    const content = turn.content.slice(0, Math.min(4000, remaining));
    if (!content) break;
    result.unshift({ role: turn.role, content });
    remaining -= content.length;
  }
  while (result[0]?.role === 'assistant') result.shift();
  return result;
}

const otherDialogOpen = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], [data-assistant-priority]')].some(element =>
  !element.closest('[data-global-assistant]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');

export function GlobalAssistant() {
  const { user, isAuthenticated, isLoading, isSigningOut } = useAuthStore();
  const { locationId } = useEffectiveLocation();
  const { pathname } = useLocation();
  const customerFacing = pathname === '/customer-display';
  const storeAnalysis = !customerFacing && isAuthenticated && !isLoading && !isSigningOut && ['ADMIN', 'MANAGER'].includes(user?.role || '') && Boolean(locationId);
  // React destroys the old thread before rendering a new scope; late responses cannot cross sessions.
  const scope = [user?.id || 'guest', user?.role || '', locationId || '', isAuthenticated, isLoading, sessionGeneration(), customerFacing ? 'customer' : 'operator'].join(':');
  return <AssistantThread key={scope} pathname={pathname} storeAnalysis={storeAnalysis} signedIn={isAuthenticated && !customerFacing} locationId={locationId || undefined} />;
}

function AssistantThread({ pathname, storeAnalysis, signedIn, locationId }: { pathname: string; storeAnalysis: boolean; signedIn: boolean; locationId?: string }) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const [dockBottom, setDockBottom] = useState(24);
  const [dockRight, setDockRight] = useState(24);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const restoreLauncherFocus = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastMessage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const position = () => {
      let bottom = window.innerWidth < 640 ? 16 : 24;
      let right = window.innerWidth < 640 ? 16 : 24;
      if (pathname === '/pos') {
        // Keep the launcher beside the desktop cart, clear of item prices and tender controls.
        if (window.innerWidth >= 768) {
          const cart = [...document.querySelectorAll<HTMLElement>('[data-sale-cart]')].find(element => element.getClientRects().length);
          if (cart) right = innerWidth - cart.getBoundingClientRect().left + 16;
        }
        for (const element of document.querySelectorAll<HTMLElement>('[data-assistant-avoid]')) {
          if (!element.getClientRects().length) continue;
          const rect = element.getBoundingClientRect();
          if (rect.top < innerHeight && rect.bottom > 0 && rect.right > innerWidth - right - 48 && rect.left < innerWidth - right) bottom = Math.max(bottom, innerHeight - rect.top + 16);
        }
      }
      setDockBottom(Math.min(bottom, Math.max(16, innerHeight - 64)));
      setDockRight(right);
    };
    const resize = new ResizeObserver(position);
    const observe = () => {
      resize.disconnect();
      document.querySelectorAll<HTMLElement>('[data-assistant-avoid], [data-sale-cart]').forEach(element => resize.observe(element));
      position();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', position);
    observe();
    return () => { resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', position); };
  }, [pathname]);

  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 639px)');
    const update = () => setMobile(viewport.matches);
    viewport.addEventListener('change', update);
    return () => viewport.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    const check = () => {
      const next = otherDialogOpen();
      setBlocked(next);
      if (next) setOpen(false);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'role', 'aria-modal'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) {
      if (restoreLauncherFocus.current && !otherDialogOpen()) launcher.current?.focus({ preventScroll: true });
      restoreLauncherFocus.current = false;
      return;
    }
    input.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !otherDialogOpen()) { event.preventDefault(); restoreLauncherFocus.current = true; setOpen(false); }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (open) lastMessage.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, pendingQuestion, open]);

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  const close = () => { restoreLauncherFocus.current = true; setOpen(false); };
  const trapKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!mobile || event.key !== 'Tab' || otherDialogOpen()) return;
    const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])].filter(element => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || activeRequest.current || Date.now() < retryAt || otherDialogOpen()) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setPendingQuestion(question); setError(null);
    const body = { question, history: boundedHistory(turns), pageContext: pageContext(pathname) };
    try {
      const response = storeAnalysis
        ? await api.post('/analytics/chat', body, { params: { locationId }, signal: controller.signal, timeout: 50000 })
        : await axios.post((import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '') + '/assistant/help', body, { signal: controller.signal, timeout: 50000 });
      if (!mounted.current || controller.signal.aborted) return;
      const answer = response.data?.data?.answer;
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('No answer received');
      setTurns(previous => [...previous, { role: 'user', content: question }, { role: 'assistant', content: answer }].slice(-40) as Turn[]);
      setDraft('');
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return;
      if (axios.isAxiosError(failure) && failure.response?.status === 429) {
        const value = failure.response.headers['retry-after'];
        const seconds = Number(value);
        const until = Number.isFinite(seconds) && seconds >= 0 ? Date.now() + seconds * 1000 : Date.parse(String(value));
        setRetryAt(Number.isFinite(until) ? until : Date.now() + 60000);
        setNow(Date.now());
        setError('Please wait before asking another question.');
      } else {
        setError('The assistant is unavailable. Your question is saved here. Try again.');
      }
    } finally {
      if (mounted.current && activeRequest.current === controller) { activeRequest.current = null; setPendingQuestion(null); }
    }
  };

  const waiting = retryAt > now;
  const suggestions = storeAnalysis ? ['How were sales today?', 'Which products need restocking?']
    : signedIn ? ['How do I scan or print?', 'How do I hold and resume a sale?'] : ['How do I sign in?', 'How do I scan or print?'];
  return <div data-global-assistant className="fixed z-[45] print:hidden" style={{ bottom: dockBottom, right: dockRight }}>
    {open && !blocked && mobile && <div className="fixed inset-0 bg-black/30" aria-hidden="true" onClick={close} />}
    {open && !blocked && <div id="pos-assistant-panel" ref={panel} role="dialog" aria-modal={mobile} aria-labelledby="pos-assistant-title" onKeyDown={trapKeys}
      style={{ bottom: mobile ? 12 : dockBottom + 64, maxHeight: mobile ? 'calc(100dvh - 24px)' : `calc(100dvh - ${dockBottom + 80}px)` }}
      className="fixed inset-x-3 sm:inset-x-auto sm:right-6 flex h-[min(36rem,calc(100dvh-2rem))] w-auto sm:w-96 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4">
        <div><h2 id="pos-assistant-title" className="text-lg font-semibold">POS Assistant</h2><p className="text-xs text-muted-foreground">{storeAnalysis ? 'Read-only store analysis and POS help' : 'General POS help'}</p></div>
        <Button variant="ghost" onClick={close} aria-label="Close assistant" className="h-9 w-9 shrink-0 p-0"><X className="h-4 w-4" /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" role="log" aria-live="polite" aria-relevant="additions" aria-label="Assistant conversation">
        {turns.length === 0 && !pendingQuestion && <div className="space-y-4"><p className="text-sm">{storeAnalysis ? 'Ask about your store or using POS.' : 'How can I help you use POS?'}</p><div className="flex flex-col items-start gap-2">{suggestions.map(suggestion => <Button key={suggestion} variant="outline" onClick={() => { setDraft(suggestion); input.current?.focus(); }} className="max-w-full whitespace-normal text-left">{suggestion}</Button>)}</div></div>}
        <div className="space-y-3">{turns.map((turn, index) => <div key={index} className={`rounded-lg p-3 text-sm whitespace-pre-wrap break-words ${turn.role === 'user' ? 'ml-6 bg-primary text-primary-foreground' : 'mr-3 bg-muted'}`}><span className="sr-only">{turn.role === 'user' ? 'You: ' : 'Assistant: '}</span>{turn.content}</div>)}
          {pendingQuestion && <><div className="ml-6 rounded-lg bg-primary p-3 text-sm text-primary-foreground whitespace-pre-wrap break-words">{pendingQuestion}</div><p role="status" className="text-sm text-muted-foreground">Thinking…</p></>}
          <div ref={lastMessage} />
        </div>
      </div>
      <form onSubmit={send} className="shrink-0 space-y-2 border-t p-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}{waiting && ` Retry in ${Math.max(1, Math.ceil((retryAt - now) / 1000))}s.`}</p>}
        <label htmlFor="pos-assistant-question" className="sr-only">Message the assistant</label>
        <textarea ref={input} id="pos-assistant-question" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} rows={2} disabled={Boolean(pendingQuestion)} placeholder="Ask a question…" className="w-full resize-none rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!draft.trim() || Boolean(pendingQuestion) || waiting}><Send className="mr-2 h-4 w-4" />{error ? 'Retry' : 'Send'}</Button></div>
      </form>
    </div>}
    <button ref={launcher} type="button" aria-label="Open POS assistant" aria-haspopup="dialog" aria-expanded={open && !blocked} aria-controls={open ? 'pos-assistant-panel' : undefined}
      onClick={() => { if (!otherDialogOpen()) setOpen(previous => !previous); }} disabled={blocked}
      className={`flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 ${open ? 'invisible sm:visible' : ''}`}>
      <MessageCircle className="h-6 w-6" aria-hidden="true" />
    </button>
  </div>;
}
