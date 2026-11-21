import { useEffect } from 'react';
import { useToast } from '../components/ui';
import { checkForUpdate } from './updater';
import { runtimePlatform, type RuntimePlatform } from './platform';

const REMINDER_KEY = 'skfb:update:notified';

/**
 * Non-blocking update check: once shortly after startup (after the intro) and
 * again whenever the device comes back online. Failures stay silent — the
 * Settings → About panel is where a failed/offline check is shown explicitly.
 */
export function useUpdateWatcher(): void {
  const toast = useToast();

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    if (typeof window === 'undefined') return;

    let stopped = false;
    let notified: string | null = null;
    try {
      notified = sessionStorage.getItem(REMINDER_KEY);
    } catch {
      /* storage unavailable */
    }

    const run = async () => {
      if (stopped || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      try {
        const status = await checkForUpdate({ platform: runtimePlatform() as RuntimePlatform });
        if (stopped || status.state !== 'available' || !status.latestVersion) return;
        if (notified === status.latestVersion) return;
        notified = status.latestVersion;
        try {
          sessionStorage.setItem(REMINDER_KEY, status.latestVersion);
        } catch {
          /* storage unavailable */
        }
        toast(`Update v${status.latestVersion} available — see Settings → About`, 'info');
      } catch {
        /* never interrupt the app for a failed background check */
      }
    };

    // Wait for the intro to finish so the toast is not hidden behind it.
    const timer = setTimeout(() => void run(), 5600);
    const onOnline = () => void run();
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [toast]);
}
