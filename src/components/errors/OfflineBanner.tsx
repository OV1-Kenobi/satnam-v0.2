/**
 * @module components/errors/OfflineBanner
 * @description Offline detection banner with queued Nostr event count.
 *
 * Monitors the browser's online/offline status and displays a sticky
 * banner at the top of the app when the user is offline. Shows the
 * count of Nostr events queued for delivery once connectivity returns.
 *
 * The service worker background sync handles actual event delivery.
 * This component is purely informational UI.
 *
 * Usage:
 * ```tsx
 * // In App.tsx — renders nothing when online
 * <OfflineBanner />
 * ```
 */

import {
  useState,
  useEffect,
  useCallback,
} from 'react';

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Hook: useOnlineStatus
// ============================================================================

/**
 * Returns the current browser online/offline status, reactively updated.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// ============================================================================
// Hook: useQueuedEventCount
// ============================================================================

/**
 * Returns the count of Nostr events queued in localStorage for
 * background sync delivery. Updated whenever localStorage changes
 * or the component re-renders after coming back online.
 */
export function useQueuedEventCount(): number {
  const [count, setCount] = useState<number>(0);

  const readQueueCount = useCallback(() => {
    try {
      const raw = localStorage.getItem('satnam_event_queue');
      if (!raw) {
        setCount(0);
        return;
      }
      const queue = JSON.parse(raw);
      if (Array.isArray(queue)) {
        setCount(queue.length);
      }
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    readQueueCount();

    // Listen for queue updates from the service worker or other tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'satnam_event_queue') {
        readQueueCount();
      }
    };

    window.addEventListener('storage', handleStorage);

    // Also poll every 5 seconds (for same-tab updates)
    const interval = setInterval(readQueueCount, 5_000);

    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, [readQueueCount]);

  return count;
}

// ============================================================================
// OfflineBanner Component
// ============================================================================

interface OfflineBannerProps {
  /** Additional CSS classes for the banner container. */
  className?: string;
}

/**
 * Offline detection banner. Renders nothing when the user is online.
 * Displays a sticky top banner when offline, with queued event count.
 */
export function OfflineBanner({ className = '' }: OfflineBannerProps): JSX.Element | null {
  const isOnline = useOnlineStatus();
  const queuedCount = useQueuedEventCount();
  const [justCameOnline, setJustCameOnline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  // Show "reconnected" flash briefly when coming back online
  useEffect(() => {
    if (isOnline && justCameOnline) {
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
        setJustCameOnline(false);
      }, 3_000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, justCameOnline]);

  // Track transition from offline → online
  const [prevOnline, setPrevOnline] = useState(isOnline);
  useEffect(() => {
    if (!prevOnline && isOnline) {
      setJustCameOnline(true);
    }
    setPrevOnline(isOnline);
  }, [isOnline, prevOnline]);

  // Reconnected flash
  if (showReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-2 bg-emerald-900/90 px-4 py-2.5 text-sm text-emerald-100 backdrop-blur-sm ${className}`}
      >
        <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-emerald-400" />
        <span>Back online{queuedCount > 0 ? ` — syncing ${queuedCount} queued event${queuedCount === 1 ? '' : 's'}` : ''}</span>
      </div>
    );
  }

  // Offline state
  if (!isOnline) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`fixed left-0 right-0 top-0 z-50 flex items-center justify-between gap-2 bg-amber-900/90 px-4 py-2.5 text-sm text-amber-100 backdrop-blur-sm ${className}`}
      >
        <div className="flex items-center gap-2">
          <WifiOffIcon className="h-4 w-4 flex-shrink-0 text-amber-400" />
          <span>
            You are offline
            {queuedCount > 0 && (
              <> — <strong>{queuedCount}</strong> event{queuedCount === 1 ? '' : 's'} queued for delivery</>
            )}
          </span>
        </div>
        <div className="flex-shrink-0">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
        </div>
      </div>
    );
  }

  // Online and stable — render nothing
  return null;
}

// ============================================================================
// Inline SVG Icons (no external dep)
// ============================================================================

function WifiOffIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" />
    </svg>
  );
}

function CheckCircleIcon({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// ============================================================================
// OfflineBannerSpacer — reserves space at top when banner is visible
// ============================================================================

/**
 * Add this component directly below the OfflineBanner to prevent content
 * from being obscured by the fixed-position banner.
 *
 * Usage:
 * ```tsx
 * <OfflineBanner />
 * <OfflineBannerSpacer />
 * <main>...</main>
 * ```
 */
export function OfflineBannerSpacer(): JSX.Element {
  const isOnline = useOnlineStatus();

  if (isOnline) return <></>;

  return <div className="h-10" aria-hidden="true" />;
}

export default OfflineBanner;


