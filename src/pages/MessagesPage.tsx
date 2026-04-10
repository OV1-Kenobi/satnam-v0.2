/**
 * Satnam v2 — Messages Page
 * Route: /messages
 * Spec: messaging-spec.md § 4 (MessagesPage)
 *
 * Responsive messaging UI:
 *   Desktop: Split panel — ThreadList (left 320px) | ChatView (right flex)
 *   Mobile:  Full-screen ThreadList → tap opens full-screen ChatView with back button
 *
 * Provides MessagingProvider and NotificationsProvider context for all
 * child components. The NotificationCenter bell appears in the page header.
 *
 * Empty state when no thread is selected (desktop only).
 */

import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import clsx from 'clsx';
import { MessageSquare, Users, Plus } from 'lucide-react';

import { MessagingProvider, useMessaging } from '../hooks/useMessaging.js';
import { NotificationsProvider } from '../hooks/useNotifications.js';
import ThreadList from '../components/messaging/ThreadList.js';
import ChatView from '../components/messaging/ChatView.js';
import NotificationCenter from '../components/messaging/NotificationCenter.js';

// ── Empty state (no thread selected, desktop) ──────────────────────────────────

function NoThreadSelected() {
  return (
    <div
      className="flex flex-col items-center justify-center flex-1 py-20 space-y-5"
      aria-label="No conversation selected"
    >
      <div className="w-20 h-20 rounded-2xl bg-[#f7931a]/10 border border-[#f7931a]/20 flex items-center justify-center">
        <MessageSquare size={36} className="text-[#f7931a]" aria-hidden="true" />
      </div>
      <div className="text-center max-w-xs">
        <h2 className="heading-display text-xl text-[#f5f5f5] mb-2">Select a Conversation</h2>
        <p className="text-sm text-[#555555]">
          Choose a thread from the list or start a new private message.
          All messages are end-to-end encrypted with NIP-17 gift-wrapping.
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-600 border-t border-slate-800 pt-4 w-64 justify-center">
        <MessageSquare size={12} aria-hidden="true" />
        <span>NIP-17 encrypted</span>
        <span>·</span>
        <Users size={12} aria-hidden="true" />
        <span>Group messaging</span>
      </div>
    </div>
  );
}

// ── Inner content (needs MessagingProvider context) ────────────────────────────

function MessagesContent() {
  const {
    threads,
    selectedThreadId,
    messages,
    selectThread,
  } = useMessaging({ selfPubkey: '' });

  // Mobile: track if we're showing the chat (vs thread list)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const selectedThread = threads.find(t => t.id === selectedThreadId) ?? null;

  function handleSelectThread(threadId: string) {
    selectThread(threadId);
    setMobileView('chat');
  }

  function handleBack() {
    setMobileView('list');
  }

  return (
    <>
      <Helmet>
        <title>Satnam — Messages</title>
        <meta
          name="description"
          content="Private, end-to-end encrypted messaging via NIP-17 gift-wrap. Direct messages, group chats, and encrypted self-notes."
        />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] flex flex-col">
        {/* Page header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#f7931a]/10 border border-[#f7931a]/20 flex items-center justify-center">
              <MessageSquare size={16} className="text-[#f7931a]" aria-hidden="true" />
            </div>
            <h1 className="heading-display text-lg text-[#f7931a]">Messages</h1>
          </div>
          <div className="flex items-center gap-2">
            <NotificationCenter showBell />
            <button
              type="button"
              aria-label="New message"
              className={clsx(
                'p-2 rounded-lg',
                'bg-[#f7931a]/10 border border-[#f7931a]/20 text-[#f7931a]',
                'hover:bg-[#f7931a]/20 transition-colors',
              )}
            >
              <Plus size={15} />
            </button>
          </div>
        </header>

        {/* Split layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Thread list panel ─────────────────────────────── */}
          {/*
            Desktop: always visible (fixed 320px)
            Mobile: full-screen when mobileView='list', hidden when 'chat'
          */}
          <aside
            className={clsx(
              'w-full md:w-80 flex-shrink-0',
              'border-r border-slate-800 bg-slate-950',
              'flex flex-col',
              // Mobile visibility
              mobileView === 'list' ? 'flex' : 'hidden',
              // Desktop: always show
              'md:flex',
            )}
            aria-label="Conversations"
          >
            <ThreadList
              threads={threads}
              selectedThreadId={selectedThreadId}
              onSelect={handleSelectThread}
              className="h-full"
            />
          </aside>

          {/* ── Chat panel ────────────────────────────────────── */}
          {/*
            Desktop: flex-1, shows empty state when nothing selected
            Mobile: full-screen when mobileView='chat', hidden when 'list'
          */}
          <section
            className={clsx(
              'flex-1 flex flex-col min-w-0',
              // Mobile visibility
              mobileView === 'chat' ? 'flex' : 'hidden',
              // Desktop: always show
              'md:flex',
            )}
            aria-label="Chat area"
          >
            {selectedThread ? (
              <ChatView
                thread={selectedThread}
                messages={messages}
                onBack={handleBack}
                className="flex-1 h-full"
              />
            ) : (
              <NoThreadSelected />
            )}
          </section>
        </div>
      </main>
    </>
  );
}

// ── Page Export (with providers) ───────────────────────────────────────────────

export default function MessagesPage() {
  return (
    <NotificationsProvider>
      <MessagingProvider>
        <MessagesContent />
      </MessagingProvider>
    </NotificationsProvider>
  );
}


