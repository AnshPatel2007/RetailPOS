import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

  setStoreInfo: (info: StoreInfo) => void;
  setReceiptSettings: (settings: ReceiptSettings) => void;
  setPaymentMethods: (methods: EnabledPaymentMethods) => void;
  setNotificationSettings: (settings: NotificationSettings) => void;
}

export const useStoreSettingsStore = create<StoreSettingsState>()(
  persist(
    (set) => ({
      storeInfo: {
        storeName: 'My Store',
        address: '',
        city: '',
        state: '',
        phone: '',
      },
      receiptSettings: {
        header: '',
        footer: 'Thank you for your purchase!',
        showAddress: true,
        showTaxBreakdown: true,
      },
      paymentMethods: {
        cash: true,
        card: true,
        giftCard: false,
        storeCredit: false,
      },
      notificationSettings: {
        lowStockAlerts: true,
        endOfDayReports: true,
        emailNotifications: false,
        notificationEmail: '',
      },

      setStoreInfo: (info) => set({ storeInfo: info }),
      setReceiptSettings: (settings) => set({ receiptSettings: settings }),
      setPaymentMethods: (methods) => set({ paymentMethods: methods }),
      setNotificationSettings: (settings) => set({ notificationSettings: settings }),
    }),
    {
      name: 'pos-store-settings',
    }
  )
);
