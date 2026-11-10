import { create } from 'zustand';

/**
 * This computer as a register: set up by a manager in Settings > Devices. Staff
 * here sign in by name + PIN, and the screen can lock between customers. The
 * register secret stays on this computer when people sign out; the lock does not
 * outlive the session that set it.
 */
export interface RegisterDevice {
  id: string;
  name: string;
  storeName: string;
  locationId: string;
  /** Secret that proves this computer was set up; the server keeps only its hash. */
  token: string;
  /** Lock the screen after this many idle minutes (0 = never). */
  autoLockMinutes: number;
}

const DEVICE_KEY = 'pos-register-device';
const LOCK_KEY = 'pos-register-locked';

const readDevice = (): RegisterDevice | null => {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
    return value && typeof value.token === 'string' && typeof value.locationId === 'string'
      ? { autoLockMinutes: 5, ...value } : null;
  } catch { return null; }
};

interface RegisterState {
  device: RegisterDevice | null;
  /** Id of the person whose session is locked, or null when unlocked. */
  lockedBy: string | null;
  setDevice: (device: RegisterDevice | null) => void;
  setAutoLock: (minutes: number) => void;
  lock: (userId: string) => void;
  unlock: () => void;
}

export const useRegisterStore = create<RegisterState>((set, get) => ({
  device: readDevice(),
  lockedBy: localStorage.getItem(LOCK_KEY),
  setDevice: device => {
    if (device) localStorage.setItem(DEVICE_KEY, JSON.stringify(device)); else localStorage.removeItem(DEVICE_KEY);
    set({ device });
  },
  setAutoLock: minutes => {
    const device = get().device;
    if (device) get().setDevice({ ...device, autoLockMinutes: minutes });
  },
  lock: userId => { localStorage.setItem(LOCK_KEY, userId); set({ lockedBy: userId }); },
  unlock: () => { localStorage.removeItem(LOCK_KEY); set({ lockedBy: null }); },
}));

/** The signed-in person can lock this screen: it is a register for their store and they have a PIN. */
export const canLockRegister = (user: { locationId: string | null; hasPin?: boolean; role: string } | null, device: RegisterDevice | null) =>
  !!user && !!device && !!user.hasPin && user.role !== 'SUPER_ADMIN' && user.locationId === device.locationId;
