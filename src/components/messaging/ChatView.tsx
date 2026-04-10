/**
 * Satnam v2 — ChatView
 * Spec: messaging-spec.md § 4 (ChatView)
 *
 * Full chat view for both DM and group threads:
 *   - Message list (chronological, date group headers)
 *   - Message bubbles: sent (right, bitcoin-orange/20) / received (left, slate-800)
 *   - Ephemeral messages: dashed border, flame icon, countdown timer (yellow-500)
 *   - Read receipts (✓ / ✓✓) Signal-style
 *   - PoL trust badge on contact names
 *   - Compose bar: text input + send + ephemeral toggle
 *   - Typing indicator placeholder
 *   - Protocol indicator per thread
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import {
  Send,
  Flame,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Shield,
  ChevronLeft,
} from 'lucide-react';
import type { Message, MessageThread, EphemeralConfig } from '../../hooks/useMessaging.js';
import { useMessaging } from '../../hooks/useMessaging.js';
import EphemeralControls, { TimerBadge } from './EphemeralControls.js';
import ProtocolIndicator from './ProtocolIndicator.js';
import GroupChatHeader from './GroupChatHeader.js';
import GroupSettingsPanel from './GroupSettingsPanel.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatViewProps {
  thread: MessageThread;
  messages: Message[];
  /** Current user pubkey */
  currentUserPubkey?: string;
  onBack?: () => void;
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CURRENT_USER = 'self';

function isSelf(senderPubkey: string): boolean {
  return senderPubkey === CURRENT_USER || senderPubkey === 'self';
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateHeader(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function sameDay(a: number, b: number): boolean {
  return new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
}

function avatarHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

// ── Read Receipt ───────────────────────────────────────────────────────────────

function ReadReceipt({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <Clock size={11} className="text-slate-600" aria-label="Sending" />;
    case 'sent':
      return <Check size={11} className="text-slate-500" aria-label="Sent" />;
    case 'delivered':
      return <CheckCheck size={11} className="text-slate-500" aria-label="Delivered" />;
    case 'read':
      return <CheckCheck size={11} className="text-[#f7931a]" aria-label="Read" />;
    case 'expired':
    case 'deleted':
      return <AlertCircle size={11} className="text-red-500" aria-label="Expired" />;
    default:
      return null;
  }
}

// ── Date Header ────────────────────────────────────────────────────────────────

function DateHeader({ timestamp }: { timestamp: number }) {
  return (
    <div className="flex items-center gap-3 py-3" aria-label={`Messages from ${formatDateHeader(timestamp)}`}>
      <div className="flex-1 h-px bg-slate-800" />
      <span className="text-[10px] text-slate-600 font-medium px-2">
        {formatDateHeader(timestamp)}
      </span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  );
}

// ── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  thread,
  showSender,
}: {
  message: Message;
  thread: MessageThread;
  showSender: boolean;
}) {
  const self = isSelf(message.senderPubkey);
  const isEphemeral = !!message.ephemeral;

  // Find sender info (participants list not available on MessageThread; use pubkey abbreviation)
  const senderName = self ? 'You' : message.senderPubkey.slice(0, 8) + '…';
  const hue = avatarHue(message.senderPubkey);

  return (
    <div
      className={clsx(
        'flex gap-2',
        self ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar (received messages, group or DM) */}
      {!self && (
        <div
          className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold text-white self-end"
          style={{ background: `hsl(${hue},50%,38%)` }}
          aria-hidden="true"
          title={senderName}
        >
          {senderName.slice(0, 2).toUpperCase()}
        </div>
      )}

      {/* Bubble */}
      <div className={clsx('flex flex-col max-w-[72%]', self ? 'items-end' : 'items-start')}>
        {/* Sender name + PoL badge (group, received, first in cluster) */}
        {!self && showSender && thread.type === 'group' && (
          <div className="flex items-center gap-1.5 mb-1 ml-1">
            <span className="text-[10px] font-medium text-slate-400">{senderName}</span>

          </div>
        )}

        {/* Message content */}
        <div
          className={clsx(
            'px-3 py-2 rounded-2xl text-sm',
            // Sent vs received
            self
              ? 'bg-[#f7931a]/20 text-slate-100 rounded-tr-sm'
              : 'bg-slate-800 text-slate-200 rounded-tl-sm',
            // Ephemeral style
            isEphemeral && 'border border-dashed border-yellow-700/60',
          )}
        >
          <p className="leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        {/* Timestamp + status + ephemeral timer */}
        <div
          className={clsx(
            'flex items-center gap-1.5 mt-0.5 px-1',
            self ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <span className="text-[10px] text-slate-600">
            {formatMessageTime(message.createdAt)}
          </span>

          {/* Read receipt (sent messages only) */}
          {self && (
            <span aria-live="polite">
              <ReadReceipt status={message.status} />
            </span>
          )}

          {/* Ephemeral timer */}
          {isEphemeral && message.expiresAt && (
            <TimerBadge expiresAt={message.expiresAt} />
          )}

          {/* Flame icon for burn-after-read */}
          {isEphemeral && message.ephemeral?.burnAfterRead && (
            <Flame size={10} className="text-orange-500" aria-label="Burns after read" />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Empty Chat State ───────────────────────────────────────────────────────────

function EmptyChat({ thread }: { thread: MessageThread }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-12 space-y-4">
      <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-2xl">
        💬
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-slate-300">
          {thread.type === 'self' ? 'Your private notebook' : `Message ${thread.type === 'group' ? thread.config.name : thread.type === 'direct' ? (thread.recipientDisplayName ?? thread.recipientPubkey.slice(0, 8)) : ''}`}
        </p>
        <p className="text-xs text-slate-600 mt-1">
          {thread.type === 'self'
            ? 'Notes are encrypted with NIP-17 gift-wrap to your own npub.'
            : 'End-to-end encrypted with NIP-17. Messages gift-wrapped to each recipient.'}
        </p>
      </div>
    </div>
  );
}

// ── Compose Bar ────────────────────────────────────────────────────────────────

function ComposeBar({
  onSend,
  isSending,
  disabled,
}: {
  onSend: (content: string, ephemeral?: EphemeralConfig) => Promise<void>;
  isSending: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [ephemeralConfig, setEphemeralConfig] = useState<EphemeralConfig | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    if (!text.trim() || isSending) return;
    const content = text.trim();
    setText('');
    await onSend(content, ephemeralConfig ?? undefined);
    textRef.current?.focus();
  }, [text, isSending, onSend, ephemeralConfig]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-resize textarea
  useEffect(() => {
    if (!textRef.current) return;
    textRef.current.style.height = 'auto';
    textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 120)}px`;
  }, [text]);

  const isEphemeralActive = ephemeralConfig !== null;

  return (
    <div className={clsx(
      'border-t border-slate-800 bg-slate-950 px-3 pt-2 pb-3',
      isEphemeralActive && 'border-t-yellow-900/40',
    )}>
      {/* Ephemeral indicator bar */}
      {isEphemeralActive && (
        <div className="flex items-center gap-1.5 mb-2 text-[10px] text-yellow-500">
          <Flame size={10} aria-hidden="true" />
          <span>
            Ephemeral:{' '}
            {ephemeralConfig.ttl
              ? `Deletes in ${Math.floor(ephemeralConfig.ttl / 60) >= 1 ? `${Math.floor(ephemeralConfig.ttl / 60)}m` : `${ephemeralConfig.ttl}s`}`
              : 'No TTL'}
            {ephemeralConfig.burnAfterRead ? ' · Burn after read' : ''}
          </span>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Ephemeral controls */}
        <EphemeralControls
          value={ephemeralConfig}
          onChange={setEphemeralConfig}
          compact
        />

        {/* Text area */}
        <textarea
          ref={textRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          aria-label="Compose message"
          disabled={disabled}
          rows={1}
          className={clsx(
            'flex-1 resize-none bg-slate-900 border rounded-xl px-3 py-2.5 text-sm text-slate-200',
            'placeholder-slate-600 focus:outline-none transition-colors duration-150',
            'min-h-[40px] max-h-[120px] overflow-y-auto',
            isEphemeralActive
              ? 'border-yellow-700/50 focus:border-yellow-500'
              : 'border-slate-800 focus:border-[#f7931a]',
            'disabled:opacity-40',
          )}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || isSending || disabled}
          aria-label="Send message"
          className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
            'transition-all duration-150 active:scale-95',
            text.trim() && !isSending
              ? 'bg-[#f7931a] text-black hover:bg-[#e8841a]'
              : 'bg-slate-800 text-slate-600',
            'disabled:pointer-events-none',
          )}
        >
          {isSending ? (
            <div className="w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" />
          ) : (
            <Send size={15} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ChatView({
  thread,
  messages,
  currentUserPubkey = 'self',
  onBack,
  className,
}: ChatViewProps) {
  const { sendMessage, isSending } = useMessaging();
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const isGroup = thread.type === 'group';
  const isDm = thread.type === 'direct';

  return (
    <div className={clsx('flex h-full', className)}>
      {/* Main chat column */}
      <div className={clsx('flex flex-col flex-1 min-w-0', showSettings && 'hidden md:flex')}>
        {/* Header */}
        {isGroup ? (
          <GroupChatHeader
            thread={thread}
            onOpenSettings={() => setShowSettings(v => !v)}
            onBack={onBack}
          />
        ) : (
          /* DM / Self header */
          <header className="flex items-center gap-3 px-4 py-3 bg-slate-950 border-b border-slate-800">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back to conversations"
                className="text-slate-400 hover:text-slate-200 transition-colors md:hidden"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {/* Avatar */}
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
              style={{ background: thread.type === 'self' ? '#f7931a' : `hsl(${avatarHue(thread.id)},50%,38%)` }}
              aria-hidden="true"
            >
              {(thread.type === "direct" ? (thread.recipientDisplayName ?? thread.recipientPubkey.slice(0, 8)) : "You").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-200 truncate">{thread.type === "direct" ? (thread.recipientDisplayName ?? thread.recipientPubkey.slice(0, 8)) : "Note to Self"}</span>
                <ProtocolIndicator protocol="nip17" />
              </div>
              {isDm && (thread as { polVerified?: boolean }).polVerified === true && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Shield size={9} className="text-[#f7931a]" aria-hidden="true" />
                  <span className="text-[10px] text-slate-500">PoL verified</span>
                </div>
              )}
            </div>
          </header>
        )}

        {/* Message list */}
        <main
          className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
          aria-label="Messages"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <EmptyChat thread={thread} />
          ) : (
            messages.map((msg, i) => {
              const prev = messages[i - 1];
              const showDate = !prev || !sameDay(prev.createdAt, msg.createdAt);
              const showSender = !prev || prev.senderPubkey !== msg.senderPubkey || showDate;

              return (
                <React.Fragment key={msg.id}>
                  {showDate && <DateHeader timestamp={msg.createdAt} />}
                  <MessageBubble
                    message={msg}
                    thread={thread}
                    showSender={showSender}
                  />
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} aria-hidden="true" />
        </main>

        {/* Compose bar */}
        <ComposeBar
          onSend={sendMessage}
          isSending={isSending}
        />
      </div>

      {/* Group settings side panel (desktop) */}
      {showSettings && isGroup && (
        <div className={clsx(
          'w-72 border-l border-slate-800 flex flex-col',
          'md:flex',
        )}>
          <GroupSettingsPanel
            thread={thread}
            onClose={() => setShowSettings(false)}
            currentUserPubkey={currentUserPubkey}
          />
        </div>
      )}

      {/* Group settings full-screen (mobile) */}
      {showSettings && isGroup && (
        <div className="md:hidden fixed inset-0 z-50 bg-slate-950">
          <GroupSettingsPanel
            thread={thread}
            onClose={() => setShowSettings(false)}
            currentUserPubkey={currentUserPubkey}
          />
        </div>
      )}
    </div>
  );
}

