import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo, useRef, SetStateAction } from 'react';

export function useResetUrlFilters() {
  const [, setParams] = useSearchParams();
  return useCallback(() => setParams({}, { replace: true }), [setParams]);
}

/** Commit related fields together; sequential router updates can lose the first field. */
export function useUrlFilterPatch() {
  const [, setParams] = useSearchParams();
  return useCallback((values: Record<string, string>, replace = true) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    for (const key of ['page', 'refundPage', 'voidPage', 'activityPage']) next.delete(key);
    return next;
  }, { replace }), [setParams]);
}

/** Filters belong to the URL so reload, bookmarks and browser Back keep the view. */
export function useUrlFilter(key: string, fallback = '', replace = true): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback((next: string) => setParams(current => {
    const updated = new URLSearchParams(current);
    if (next === fallback || next === '') updated.delete(key); else updated.set(key, next);
    if (key !== 'page' && !key.endsWith('Page') && key !== 'record') {
      updated.delete('page'); updated.delete('refundPage'); updated.delete('voidPage'); updated.delete('activityPage');
    }
    return updated;
  }, { replace }), [key, fallback, setParams, replace]);
  return [value, set];
}

export function useUrlPage(): [number, (value: number) => void] {
  const [raw, set] = useUrlFilter('page', '1');
  const page = /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 1_000_000_000 ? Number(raw) : 1;
  return [page, useCallback((next: number) => set(String(next)), [set])];
}

/** Restore only known filter fields with the expected primitive types. */
export function useUrlObject<T extends Record<string, string | boolean | string[] | null>>(key: string, defaults: T): [T, (value: SetStateAction<T>) => void] {
  const initial = useRef(defaults).current;
  const [raw, setRaw] = useUrlFilter(key);
  const value = useMemo(() => {
    const result = { ...initial };
    try {
      if (raw.length > 12000) return result;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
      for (const field of Object.keys(initial) as (keyof T)[]) {
        const next = parsed[field], expected = initial[field];
        const valid = Array.isArray(expected) ? Array.isArray(next) && next.length <= 100 && next.every(item => typeof item === 'string' && item.length <= 200)
          : expected === null ? next === null || typeof next === 'boolean'
          : typeof next === typeof expected && (typeof next !== 'string' || next.length <= 500);
        if (valid) result[field] = next;
      }
    } catch { /* Malformed bookmarks use the normal defaults. */ }
    return result;
  }, [initial, raw]);
  const setValue = useCallback((next: SetStateAction<T>) => setRaw(JSON.stringify(typeof next === 'function' ? next(value) : next)), [setRaw, value]);
  return [value, setValue];
}
