import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { locationService } from '@/services/api';
import { hardware } from '@/services/hardware';

export interface StoreInfo {
  taxRate?: number;
  storeName: string;
  address: string;
  city: string;
  state: string;
  phone: string;
}

export interface ReceiptSettings {
  header: string;
  footer: string;
  showAddress: boolean;
  showTaxBreakdown: boolean;
}

export interface EnabledPaymentMethods {
  cash: boolean;
  card: boolean;
  giftCard: boolean;
  storeCredit: boolean;
}

export interface NotificationSettings {
  lowStockAlerts: boolean;
  endOfDayReports: boolean;
  emailNotifications: boolean;
  notificationEmail: string;
}

interface StoreSettingsState {
  timezone: string | null;
  storeInfo: StoreInfo;
  receiptSettings: ReceiptSettings;
  paymentMethods: EnabledPaymentMethods;
  notificationSettings: NotificationSettings;
  locationId: string | null;
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;

  setStoreInfo: (info: StoreInfo) => void;
  setReceiptSettings: (settings: ReceiptSettings) => void;
  setPaymentMethods: (methods: EnabledPaymentMethods) => void;
  setNotificationSettings: (settings: NotificationSettings) => void;

  // Sync with backend
  fetchSettings: (locationId?: string) => Promise<void>;
  saveStoreInfo: (info: StoreInfo) => Promise<void>;
  saveTaxRate: (rate: number) => Promise<void>;
  saveReceiptSettings: (settings: ReceiptSettings) => Promise<void>;
  savePaymentMethods: (methods: EnabledPaymentMethods) => Promise<void>;
  saveNotificationSettings: (settings: NotificationSettings) => Promise<void>;
  reset: () => void;
}

const defaultStoreInfo: StoreInfo = {
  storeName: 'My Store',
  taxRate: 0,
  address: '',
  city: '',
  state: '',
  phone: '',
};

const defaultReceiptSettings: ReceiptSettings = {
  header: '',
  footer: 'Thank you for your purchase!',
  showAddress: true,
  showTaxBreakdown: true,
};

const defaultPaymentMethods: EnabledPaymentMethods = {
  cash: true,
  card: true,
  giftCard: false,
  storeCredit: false,
};

const defaultNotificationSettings: NotificationSettings = {
  lowStockAlerts: true,
  endOfDayReports: true,
  emailNotifications: false,
  notificationEmail: '',
};

let generation = 0;
let pending: { locationId: string; promise: Promise<void> } | null = null;
const defaults = () => ({ timezone: null as string | null, storeInfo: defaultStoreInfo, receiptSettings: defaultReceiptSettings, paymentMethods: defaultPaymentMethods, notificationSettings: defaultNotificationSettings });

export const useStoreSettingsStore = create<StoreSettingsState>()(persist((set, get) => {
  const accept = (data: any) => {
    const settings = data.settings || {};
    const storeInfo = { storeName: data.name || 'My Store', taxRate: data.taxRate || 0, address: data.address || '', city: data.city || '', state: data.state || '', phone: data.phone || '' };
    const receiptSettings = { ...defaultReceiptSettings, ...settings.receiptSettings };
    hardware.applyStoreBranding(storeInfo, receiptSettings);
    set({ timezone: data.timezone || null, storeInfo, receiptSettings, paymentMethods: { ...defaultPaymentMethods, ...settings.paymentMethods }, notificationSettings: { ...defaultNotificationSettings, ...settings.notificationSettings }, locationId: data.id, isLoaded: true, isLoading: false, error: null });
  };
  const save = async (patch: Record<string, unknown>) => {
    const { locationId, isLoaded, error } = get();
    if (!locationId || !isLoaded || error) throw new Error('Load current store settings before saving');
    const current = generation;
    const response = await locationService.updateMySettings({ locationId, ...patch });
    if (current === generation && get().locationId === locationId) accept(response.data.data);
  };
  return {
    ...defaults(), locationId: null, isLoaded: false, isLoading: false, error: null,
    setStoreInfo: info => set({ storeInfo: info }),
    setReceiptSettings: receiptSettings => set({ receiptSettings }),
    setPaymentMethods: paymentMethods => set({ paymentMethods }),
    setNotificationSettings: notificationSettings => set({ notificationSettings }),
    fetchSettings: (locationId?: string) => {
      if (!locationId) { get().reset(); return Promise.resolve(); }
      if (pending?.locationId === locationId) return pending.promise;
      const current = ++generation;
      if (get().locationId !== locationId) {
        hardware.applyStoreBranding(defaultStoreInfo, defaultReceiptSettings);
        set({ ...defaults(), locationId, isLoaded: false });
      }
      set({ isLoading: true, error: null });
      const promise = (async () => {
        try {
          const response = await locationService.getMySettings(locationId);
          if (current === generation && get().locationId === locationId) accept(response.data.data);
        } catch (error: any) {
          if (current === generation) set({ isLoading: false, error: error.response?.data?.error || 'Could not load store settings. Retry before changing configuration.' });
        } finally { if (current === generation) pending = null; }
      })();
      pending = { locationId, promise };
      return promise;
    },
    saveStoreInfo: storeInfo => save({ storeInfo }),
    saveTaxRate: taxRate => save({ storeInfo: { taxRate } }),
    saveReceiptSettings: receiptSettings => save({ receiptSettings }),
    savePaymentMethods: paymentMethods => save({ paymentMethods }),
    saveNotificationSettings: notificationSettings => save({ notificationSettings }),
    reset: () => {
      generation++; pending = null;
      hardware.applyStoreBranding(defaultStoreInfo, defaultReceiptSettings);
      set({ ...defaults(), locationId: null, isLoaded: false, isLoading: false, error: null });
    },
  };
}, { name: 'pos-store-settings', version: 1, migrate: (state: any) => ({ ...state, isLoaded: false, isLoading: false, error: null }), partialize: state => ({ storeInfo: state.storeInfo, receiptSettings: state.receiptSettings, paymentMethods: state.paymentMethods, notificationSettings: state.notificationSettings, locationId: state.locationId }) }));
