/**
 * @module components/errors/OfflineBanner
 * @description Offline detection banner.
 *
 * Monitors the browser's online/offline status and displays a sticky
 * banner at the top of the app when the user is offline.
 *
 * A-6 fix (2026-08-25): the former useQueuedEventCount hook read the
 * localStorage key 'satnam_event_queue', which NOTHING in the codebase
 * writes (the service worker queues into IndexedDB satnam-sw-db /
 * nostr-event-queue) — a permanently-dead read rendering a fake count of
 * zero. Removed rather than wired: bridging the SW's IndexedDB queue to
 * page state needs cross-context invalidation that is not worth building
 * for an unmounted informational component. Disposition: delete-from-repo;
 * recovery point 78e71b0 on origin. The component itself is currently not
 * mounted in App.tsx — kept for future use with its online/offline core.
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
} from 'react';

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
// OfflineBanner Component
// ============================================================================

interface OfflineBannerProps {
  /** Additional CSS classes for the banner container. */
  className?: string;
}

/**
 * Offline detection banner. Renders nothing when the user is online.
 */
export function OfflineBanner({ className = '' }: OfflineBannerProps): JSX.Element | null {
  const isOnline = useOnlineStatus();
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
        <span>Back online</span>
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
          <span>You are offline</span>
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


