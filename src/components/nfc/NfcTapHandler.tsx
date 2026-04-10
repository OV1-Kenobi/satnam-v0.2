/**
 * @component NfcTapHandler
 * @description NFC tap event handler — Web NFC API (Android) + URL handler (iOS).
 *
 * Abstracts the platform difference:
 * - Android Chrome: Uses NDEFReader Web NFC API to read NDEF records
 * - iOS Safari: Intercepts Universal Links from NTAG424 SUN URLs
 *
 * Renders nothing visible — provides NFC functionality as a side-effect.
 * Consumer components subscribe to tap events via the onTap callback.
 */

import { useEffect, useRef } from 'react';
import {
  isWebNfcAvailable,
  getNfcMethod,
  registerNfcUniversalLinkHandler,
  unregisterNfcUniversalLinkHandler,
  parseNfcUrl,
  type NfcUrlParams,
} from '../../lib/nfc/ios-fallback.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NfcTapEvent {
  cardUid: string;
  piccDataHex: string;
  cmacHex: string;
  rawUrl?: string;
  platform: 'android' | 'ios';
}

interface NfcTapHandlerProps {
  /** Called when an NFC card tap is detected and parsed */
  onTap: (event: NfcTapEvent) => void;
  /** Called on NFC errors */
  onError?: (error: Error) => void;
  /** Whether to actively scan (for Web NFC only) */
  active?: boolean;
  /** Optional children to render inside this handler */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Web NFC (Android Chrome)
// ---------------------------------------------------------------------------

function useWebNfc(
  active: boolean,
  onTap: (event: NfcTapEvent) => void,
  onError?: (error: Error) => void,
) {
  const readerRef = useRef<any>(null);

  useEffect(() => {
    if (!active || !isWebNfcAvailable()) return;

    let mounted = true;

    async function startScan() {
      try {
        const NDEFReader = (window as any).NDEFReader;
        const reader = new NDEFReader();
        readerRef.current = reader;

        await reader.scan();

        reader.onreading = (event: any) => {
          if (!mounted) return;

          try {
            // Parse NDEF records for NFC URL
            for (const record of event.message.records) {
              if (record.recordType === 'url') {
                const url = new TextDecoder().decode(record.data);
                const params = parseNfcUrl(url);
                if (params) {
                  onTap({
                    ...params,
                    rawUrl: url,
                    platform: 'android',
                  });
                  return;
                }
              } else if (record.recordType === 'text') {
                // Some NTAG424 configurations use text records
                const text = new TextDecoder().decode(record.data);
                const params = parseNfcUrl(text);
                if (params) {
                  onTap({
                    ...params,
                    rawUrl: text,
                    platform: 'android',
                  });
                  return;
                }
              }
            }

            // Fallback: use the serial number as UID if available
            if (event.serialNumber) {
              onTap({
                cardUid: event.serialNumber.replace(/:/g, '').toLowerCase(),
                piccDataHex: '',
                cmacHex: '',
                platform: 'android',
              });
            }
          } catch (err) {
            console.error('[NfcTapHandler] Error parsing NFC record:', err);
          }
        };

        reader.onerror = (event: any) => {
          const error = new Error(event.message ?? 'NFC read error');
          onError?.(error);
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to start NFC scan');
        // NotAllowedError means user denied permission
        if (error.name === 'NotAllowedError') {
          onError?.(new Error('NFC permission denied. Please allow NFC access.'));
        } else {
          onError?.(error);
        }
      }
    }

    startScan();

    return () => {
      mounted = false;
      // NDEFReader doesn't have an explicit stop method in most browsers
      // The reader will be garbage collected when the component unmounts
      readerRef.current = null;
    };
  }, [active, onTap, onError]);
}

// ---------------------------------------------------------------------------
// iOS Universal Link handler
// ---------------------------------------------------------------------------

function useIosNfc(
  onTap: (event: NfcTapEvent) => void,
) {
  useEffect(() => {
    registerNfcUniversalLinkHandler((params: NfcUrlParams) => {
      onTap({
        ...params,
        platform: 'ios',
      });
    });

    return () => {
      unregisterNfcUniversalLinkHandler();
    };
  }, [onTap]);
}

// ---------------------------------------------------------------------------
// NFC status indicator
// ---------------------------------------------------------------------------

export function NfcStatusBadge({ className }: { className?: string }) {
  const method = getNfcMethod();

  const config: Record<string, { label: string; color: string }> = {
    'web-nfc':       { label: '⚡ NFC Ready',   color: 'text-green-500' },
    'universal-link': { label: '📱 Tap Ready',   color: 'text-[#3B82F6]' },
    'none':          { label: '⊘ No NFC',       color: 'text-[#555555]' },
  };

  const { label, color } = config[method] ?? { label: '⊘ No NFC', color: 'text-[#555555]' };

  return (
    <span className={`text-xs ${color} ${className ?? ''}`} aria-label={`NFC status: ${label}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function NfcTapHandler({
  onTap,
  onError,
  active = true,
  children,
}: NfcTapHandlerProps) {
  const nfcMethod = getNfcMethod();

  // Register appropriate handler based on platform
  useWebNfc(active && nfcMethod === 'web-nfc', onTap, onError);
  useIosNfc(onTap);

  // For Android: show scan UI if no children provided
  if (nfcMethod === 'web-nfc' && active && !children) {
    return (
      <div className="text-center space-y-4 py-8">
        {/* Animated NFC ring */}
        <div className="relative w-24 h-24 mx-auto">
          <div className="absolute inset-0 rounded-full border-2 border-[#F7931A]/20 animate-ping" />
          <div className="absolute inset-2 rounded-full border-2 border-[#F7931A]/40 animate-ping" style={{ animationDelay: '0.2s' }} />
          <div className="absolute inset-4 rounded-full border-2 border-[#F7931A] flex items-center justify-center">
            <span className="text-3xl" aria-hidden="true">📳</span>
          </div>
        </div>
        <div>
          <p className="text-[#f5f5f5] font-semibold">Ready to Scan</p>
          <p className="text-sm text-[#555555] mt-1">Hold your NFC card near the top of your phone</p>
        </div>
      </div>
    );
  }

  if (nfcMethod === 'universal-link' && !children) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="w-20 h-20 mx-auto rounded-full bg-[#3B82F6]/10 border-2 border-[#3B82F6]/40 flex items-center justify-center">
          <span className="text-3xl" aria-hidden="true">📱</span>
        </div>
        <div>
          <p className="text-[#f5f5f5] font-semibold">iOS NFC Ready</p>
          <p className="text-sm text-[#555555] mt-1">
            Tap your card to your iPhone. Safari will open this app automatically.
          </p>
        </div>
      </div>
    );
  }

  if (nfcMethod === 'none' && !children) {
    return (
      <div className="text-center py-8">
        <p className="text-[#555555] text-sm">NFC is not supported on this device.</p>
      </div>
    );
  }

  return <>{children}</>;
}


