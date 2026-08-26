/**
 * @module components/errors/OfflineBanner
 * @description Offline detection banner wired to the REAL sync outbox.
 *
 * Monitors the browser's online/offline status and displays a sticky
 * banner at the top of the app when the user is offline.
 *
 * A-6 rewire (W2.1, founder product call): the queued-event count now reads
 * the service worker's ACTUAL IndexedDB outbox — DB `satnam-sw-db`, store
 * `nostr-event-queue` (public/sw.js :286-288) — instead of the dead
 * localStorage key 'satnam_event_queue' that nothing wrote.
 *
 * DISPLAY RULES (exact):
 * - offline  + queued > 0 → amber banner: "You are offline — N events
 *   queued for delivery" (count refreshed every 2s while offline)
 * - offline  + queued = 0 → amber banner: "You are offline"
 * - offline→online transition with queued > 0 at that moment → green flash
 *   for 3s: "Back online — syncing N queued event(s)"
 * - otherwise online → renders nothing
 * IndexedDB unavailability degrades silently to a zero count.
 */

import {
  useState,
  useEffect,
  useCallback,
} from 'react';

// ============================================================================
// Outbox reader (real source of truth = the service worker's sync queue)
// ============================================================================

const SW_DB_NAME = 'satnam-sw-db';
const SW_STORE_NAME = 'nostr-event-queue';

/**
 * Count events currently queued in the service worker's IndexedDB outbox.
 * Resolves 0 when IndexedDB is unavailable or anything fails — the count is
 * informational only and must never break rendering.
 */
export async function readOutboxCountFromIdb(): Promise<number> {
  try {
    if (typeof indexedDB === 'undefined') return 0;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(SW_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const target = e.target as IDBOpenDBRequest;
        const db = target.result;
        // Same shape the SW creates (:296) — opening first must not clobber it.
        if (!db.objectStoreNames.contains(SW_STORE_NAME)) {
          db.createObjectStore(SW_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(SW_STORE_NAME, 'readonly');
      const req = tx.objectStore(SW_STORE_NAME).count();
      req.onsuccess = () => resolve(req.result ?? 0);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return count;
  } catch {
    return 0;
  }
}

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
// Hook: useQueuedEventCount (rewired to the real outbox)
// ============================================================================

/**
 * Returns the count of Nostr events queued in the service worker's IndexedDB
 * outbox for background-sync delivery. Polls while offline (the queue can
 * grow without local events firing), refreshes on mount/online transitions,
 * and degrades to 0 when IndexedDB is unavailable.
 *
 * @param readQueue - optional injected reader (tests); defaults to the
 *                    real IndexedDB outbox reader.
 */
export function useQueuedEventCount(
  readQueue: () => Promise<number> = readOutboxCountFromIdb,
): number {
  const [count, setCount] = useState<number>(0);

  const refresh = useCallback(async () => {
    try {
      setCount(await readQueue());
    } catch {
      setCount(0);
    }
  }, [readQueue]);

  const isOnline = useOnlineStatus();

  useEffect(() => {
    void refresh();

    // While OFFLINE the queue can grow (client enqueues failed publishes),
    // so poll; while online the SW drains it on sync and the next
    // transition/mount refresh covers the UI.
    const interval = setInterval(() => { void refresh(); }, isOnline ? 10_000 : 2_000);
    return () => clearInterval(interval);
  }, [refresh, isOnline]);

  return count;
}

// ============================================================================
// OfflineBanner Component
// ============================================================================

interface OfflineBannerProps {
  /** Additional CSS classes for the banner container. */
  className?: string;
  /**
   * Test seam: override the outbox reader used by the queue-count hook.
   */
  readQueue?: () => Promise<number>;
}

/**
 * Offline detection banner. Renders nothing when the user is online.
 */
export function OfflineBanner({ className = '', readQueue }: OfflineBannerProps): JSX.Element | null {
  const isOnline = useOnlineStatus();
  const queuedCount = useQueuedEventCount(readQueue);
  const [justCameOnline, setJustCameOnline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);
  // Snapshot of the queue size at the moment we came back online, so the
  // "syncing" flash reports what is being handed off even as it drains.
  const [syncingCount, setSyncingCount] = useState(0);

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

  const [prevOnline, setPrevOnline] = useState(isOnline);
  useEffect(() => {
    if (!prevOnline && isOnline) {
      setSyncingCount(queuedCount);
      setJustCameOnline(true);
    }
    setPrevOnline(isOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // Reconnected flash
  if (showReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-2 bg-emerald-900/90 px-4 py-2.5 text-sm text-emerald-100 backdrop-blur-sm ${className}`}
      >
        <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-emerald-400" />
        <span>
          Back online
          {syncingCount > 0 ? ` — syncing ${syncingCount} queued event${syncingCount === 1 ? '' : 's'}` : ''}
        </span>
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


