import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { locationService } from '@/services/api';

export interface StoreInfo {
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
  storeInfo: StoreInfo;
  receiptSettings: ReceiptSettings;
  paymentMethods: EnabledPaymentMethods;
  notificationSettings: NotificationSettings;
  locationId: string | null;
  isLoaded: boolean;

  setStoreInfo: (info: StoreInfo) => void;
  setReceiptSettings: (settings: ReceiptSettings) => void;
  setPaymentMethods: (methods: EnabledPaymentMethods) => void;
  setNotificationSettings: (settings: NotificationSettings) => void;

  // Sync with backend
  fetchSettings: (locationId?: string) => Promise<void>;
  saveStoreInfo: (info: StoreInfo) => Promise<void>;
  saveReceiptSettings: (settings: ReceiptSettings) => Promise<void>;
  savePaymentMethods: (methods: EnabledPaymentMethods) => Promise<void>;
  saveNotificationSettings: (settings: NotificationSettings) => Promise<void>;
  reset: () => void;
}

const defaultStoreInfo: StoreInfo = {
  storeName: 'My Store',
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

export const useStoreSettingsStore = create<StoreSettingsState>()(
  persist(
    (set, get) => ({
      storeInfo: defaultStoreInfo,
      receiptSettings: defaultReceiptSettings,
      paymentMethods: defaultPaymentMethods,
      notificationSettings: defaultNotificationSettings,
      locationId: null,
      isLoaded: false,

      setStoreInfo: (info) => set({ storeInfo: info }),
      setReceiptSettings: (settings) => set({ receiptSettings: settings }),
      setPaymentMethods: (methods) => set({ paymentMethods: methods }),
      setNotificationSettings: (settings) => set({ notificationSettings: settings }),

      fetchSettings: async (locationId?: string) => {
        try {
          const res = await locationService.getMySettings(locationId);
          const data = res.data.data;
          const settings = data.settings || {};

          set({
            storeInfo: {
              storeName: data.name || 'My Store',
              address: data.address || '',
              city: data.city || '',
              state: data.state || '',
              phone: data.phone || '',
            },
            receiptSettings: settings.receiptSettings || defaultReceiptSettings,
            paymentMethods: settings.paymentMethods || defaultPaymentMethods,
            notificationSettings: settings.notificationSettings || defaultNotificationSettings,
            locationId: data.id,
            isLoaded: true,
          });
        } catch {
          // If fetch fails (e.g. cashier without permission), keep local state
          set({ isLoaded: true });
        }
      },

      // Savers update local state only after the backend write succeeds, so a
      // failed save doesn't leave the UI claiming settings that were never stored
      saveStoreInfo: async (info: StoreInfo) => {
        await locationService.updateMySettings({
          locationId: get().locationId,
          storeInfo: info,
        });
        set({ storeInfo: info });
      },

      saveReceiptSettings: async (settings: ReceiptSettings) => {
        await locationService.updateMySettings({
          locationId: get().locationId,
          receiptSettings: settings,
        });
        set({ receiptSettings: settings });
      },

      savePaymentMethods: async (methods: EnabledPaymentMethods) => {
        await locationService.updateMySettings({
          locationId: get().locationId,
          paymentMethods: methods,
        });
        set({ paymentMethods: methods });
      },

      saveNotificationSettings: async (settings: NotificationSettings) => {
        await locationService.updateMySettings({
          locationId: get().locationId,
          notificationSettings: settings,
        });
        set({ notificationSettings: settings });
      },

      reset: () => {
        set({
          storeInfo: defaultStoreInfo,
          receiptSettings: defaultReceiptSettings,
          paymentMethods: defaultPaymentMethods,
          notificationSettings: defaultNotificationSettings,
          locationId: null,
          isLoaded: false,
        });
      },
    }),
    {
      name: 'pos-store-settings',
    }
  )
);
