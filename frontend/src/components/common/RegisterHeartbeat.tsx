import { useEffect } from 'react';
import { pulseService } from '@/services/api';
import { isOffline } from '@/services/connection';
import { useRegisterStore } from '@/store/registerStore';
import { useAuthStore } from '@/store/authStore';

/**
 * Store Pulse: a computer set up as a register reports in once a minute while someone
 * is signed in on it, so the owner hears when a register goes quiet with a drawer
 * open. Never sent offline; a register the server no longer knows stops reporting.
 */
export function RegisterHeartbeat() {
  const device = useRegisterStore(state => state.device);
  const user = useAuthStore(state => state.user);
  const signedIn = useAuthStore(state => state.isAuthenticated);
  const token = device && signedIn && user && user.role !== 'SUPER_ADMIN' && user.locationId === device.locationId ? device.token : null;
  useEffect(() => {
    if (!token) return;
    const send = () => {
      if (isOffline()) return;
      pulseService.heartbeat(token).catch((error: { response?: { status?: number } }) => {
        if (error.response?.status === 404) window.clearInterval(timer);
      });
    };
    const timer = window.setInterval(send, 60000);
    send();
    return () => window.clearInterval(timer);
  }, [token, user?.id]);
  return null;
}
