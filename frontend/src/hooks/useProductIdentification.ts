import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { productService } from '@/services/api';
import { matchCatalogCategory } from '@/lib/catalogCategory';

type IdentityField = 'sku' | 'name' | 'description' | 'categoryId' | 'image' | 'minimumAge';
type IdentityDraft = Record<IdentityField, string> & { barcode: string };
interface Identification {
  found: boolean;
  status?: 'found' | 'not_found' | 'unavailable' | 'invalid';
  name?: string | null;
  description?: string | null;
  category?: string | null;
  categoryCandidates?: string[];
  missingFields?: string[];
  enrichmentUnavailable?: boolean;
  retryAfterSeconds?: number;
  image?: string | null;
  imageCandidates?: { url: string; source: string; kind: 'catalog' | 'community' }[];
  imageStatus?: 'catalog' | 'community_only' | 'missing';
  ageRestriction?: { status: 'restricted' | 'review' | 'unknown'; minimumAge: number | null; reason: string };
  source?: string[];
  attributions?: { label: string; url: string }[];
  existingProductId?: string;
}
interface LookupState {
  kind: 'idle' | 'loading' | 'found' | 'not_found' | 'unavailable' | 'invalid';
  message: string;
  info?: Identification;
}
const idle: LookupState = { kind: 'idle', message: '' };
const fields: IdentityField[] = ['sku', 'name', 'description', 'categoryId', 'image', 'minimumAge'];
const automaticBarcode = (value: string) => /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value);

/** Photos are sent only after the user explicitly chooses one. */
async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  return new Promise((resolve, reject) => {
    const image = new Image(), url = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch { reject(new Error('Could not read this image.')); }
      finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image.')); };
    image.src = url;
  });
}

export function useProductIdentification<T extends IdentityDraft>({ open, enabled, editing, contextKey, draft, setDraft, categories }: {
  open: boolean; enabled: boolean; editing: boolean; contextKey: string; draft: T;
  setDraft: Dispatch<SetStateAction<T>>; categories: { id: string; name: string }[];
}) {
  const [state, setState] = useState<LookupState>(idle);
  const live = useRef({ open, enabled, editing, contextKey, draft, categories });
  live.current = { open, enabled, editing, contextKey, draft, categories };
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const revision = useRef(0);
  const attemptedBarcode = useRef('');
  const generated = useRef<Partial<Record<IdentityField, string>>>({});
  const touched = useRef(new Set<IdentityField>());

  const cancel = useCallback(() => {
    revision.current++;
    request.current?.abort(); request.current = null;
    clearTimeout(timer.current);
  }, []);
  const reset = useCallback(() => {
    cancel(); attemptedBarcode.current = ''; generated.current = {}; touched.current.clear(); setState(idle);
  }, [cancel]);
  useEffect(() => { reset(); return cancel; }, [open, contextKey, enabled, reset, cancel]);

  const editIdentity = (field: IdentityField, value: string) => {
    touched.current.add(field);
    delete generated.current[field];
    setDraft(previous => ({ ...previous, [field]: value }));
  };
  const changeBarcode = (barcode: string) => {
    cancel(); attemptedBarcode.current = ''; setState(idle);
    const previousGenerated = { ...generated.current };
    generated.current = {};
    setDraft(previous => {
      const next = { ...previous, barcode };
      for (const field of fields) {
        // A changed or unknown barcode must never silently remove a sales restriction.
        if (field === 'minimumAge') continue;
        if (!touched.current.has(field) && previousGenerated[field] !== undefined && previous[field] === previousGenerated[field]) next[field] = '';
      }
      return next;
    });
  };

  const identify = useCallback(async (photo?: File, force = false) => {
    const current = live.current;
    if (!current.open || !current.enabled) return;
    const barcode = current.draft.barcode.trim();
    if (!photo && !barcode) return;
    if (!photo && !force && attemptedBarcode.current === barcode) return;
    cancel();
    attemptedBarcode.current = barcode;
    const controller = new AbortController(); request.current = controller;
    const version = revision.current, scope = current.contextKey;
    const active = () => !controller.signal.aborted && revision.current === version && live.current.open && live.current.enabled && live.current.contextKey === scope && live.current.draft.barcode.trim() === barcode;
    setState(previous => ({ kind: 'loading', info: previous.info, message: photo ? 'Reading product label…' : 'Looking up barcode…' }));
    // A barcode is a useful editable SKU, even when a public catalog has no match.
    if (barcode && !current.editing && !current.draft.sku && !touched.current.has('sku')) {
      generated.current.sku = barcode;
      setDraft(previous => ({ ...previous, sku: previous.sku || barcode }));
    }
    try {
      const image = photo ? await compressPhoto(photo) : undefined;
      if (!active()) return;
      const response = await productService.identify({ barcode: barcode || undefined, image }, controller.signal);
      if (!active()) return;
      const info: Identification = response.data.data;
      if (!info.found) {
        const kind = info.status === 'unavailable' ? 'unavailable' : info.status === 'invalid' ? 'invalid' : 'not_found';
        setState({ kind, message: kind === 'unavailable' ? 'Product lookup is temporarily unavailable. Retry or enter the details manually.' : kind === 'invalid' ? 'This barcode cannot be looked up. Check the code or enter the details manually.' : 'No catalog match. Enter the details manually or try a label photo.' });
        return;
      }
      const category = matchCatalogCategory(live.current.categories, [...(info.categoryCandidates || []), ...(info.category ? [info.category] : [])]);
      const suggestions: Partial<Record<IdentityField, string>> = {
        name: info.name || undefined, description: info.description || undefined, categoryId: category?.id, image: info.image || undefined,
        minimumAge: info.ageRestriction?.status === 'restricted' && info.ageRestriction.minimumAge === 21 ? '21' : undefined,
      };
      setDraft(previous => {
        if (!active()) return previous;
        const next = { ...previous };
        for (const field of fields) {
          const value = suggestions[field];
          if (value && !touched.current.has(field) && (!previous[field] || previous[field] === generated.current[field])) {
            next[field] = value; generated.current[field] = value;
          }
        }
        return next;
      });
      setState({ kind: 'found', info, message: info.existingProductId && !current.editing
        ? 'This barcode is already in your store. Open the existing product to update it.'
        : info.enrichmentUnavailable ? 'Product found. Some catalog details could not be retrieved; you can retry or complete them manually.'
        : info.missingFields?.length ? 'Product found with limited catalog details. Review the fields below.'
        : 'Product details found. Review them, then enter your prices and stock.' });
    } catch (error: unknown) {
      if (!active()) return;
      setState({ kind: 'unavailable', message: photo && error instanceof Error && !('response' in error) ? error.message : 'Product lookup is temporarily unavailable. Retry or enter the details manually.' });
    } finally { if (request.current === controller) request.current = null; }
  }, [cancel, setDraft]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!open || !enabled || editing || !automaticBarcode(draft.barcode.trim())) return;
    timer.current = setTimeout(() => { void identify(); }, 650);
    return () => clearTimeout(timer.current);
  }, [draft.barcode, open, enabled, editing, identify]);

  // Categories can finish loading after the public lookup. Still respect manual edits.
  useEffect(() => {
    if (!open || !enabled || !state.info || touched.current.has('categoryId')) return;
    const info = state.info;
    const category = matchCatalogCategory(categories, [...(info.categoryCandidates || []), ...(info.category ? [info.category] : [])]);
    if (!category) return;
    setDraft(previous => {
      if (touched.current.has('categoryId') || (previous.categoryId && previous.categoryId !== generated.current.categoryId)) return previous;
      if (previous.categoryId === category.id) return previous;
      generated.current.categoryId = category.id;
      return { ...previous, categoryId: category.id };
    });
  }, [categories, state.info, open, enabled, setDraft]);

  return { state, identifying: state.kind === 'loading', identify, reset, changeBarcode, editIdentity };
}
