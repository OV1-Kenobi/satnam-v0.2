/**
 * @file offline-banner.test.tsx
 * @description Component tests for the W2.1-rewired OfflineBanner: real
 * outbox count via injectable reader, display rules, and graceful
 * degradation when the reader fails.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OfflineBanner } from '../../src/components/errors/OfflineBanner';

/** Stub navigator.onLine (jsdom exposes it as a getter on the prototype). */
function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  });
  fireEvent(window, value ? new Event('online') : new Event('offline'));
}

beforeEach(() => {
  cleanup();
  setOnline(true);
});

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe('OfflineBanner (W2.1 rewire)', () => {
  it('renders nothing when online and stable', () => {
    const { container } = render(<OfflineBanner readQueue={async () => 0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offline with queued events shows the amber banner and exact count', async () => {
    setOnline(false);
    const { container } = render(<OfflineBanner readQueue={async () => 3} />);
    await waitFor(() => expect(container.textContent).toContain('You are offline'));
    await waitFor(() => {
      expect(container.textContent).toContain('3');
      expect(container.textContent).toContain('events queued for delivery');
    });
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('offline with an empty queue shows the plain offline message', async () => {
    setOnline(false);
    const { container } = render(<OfflineBanner readQueue={async () => 0} />);
    await waitFor(() => expect(container.textContent).toContain('You are offline'));
    expect(container.textContent).not.toContain('queued for delivery');
  });

  it('singularizes one queued event', async () => {
    setOnline(false);
    const { container } = render(<OfflineBanner readQueue={async () => 1} />);
    await waitFor(() => expect(container.textContent).toContain('1 event queued for delivery'));
    expect(container.textContent).not.toContain('events queued');
  });

  it('degrades gracefully when the outbox reader rejects (count treated as 0)', async () => {
    setOnline(false);
    const { container } = render(<OfflineBanner readQueue={async () => { throw new Error('idb unavailable'); }} />);
    await waitFor(() => expect(container.textContent).toContain('You are offline'));
    expect(container.textContent).not.toContain('queued for delivery');
  });

  it('reconnect flash reports the queue snapshot taken at transition', async () => {
    let queued = 2;
    setOnline(false);
    const { container } = render(
      <OfflineBanner readQueue={async () => queued} />,
    );
    await waitFor(() => expect(container.textContent).toContain('You are offline'));

    // Come back online while two events remain queued
    setOnline(true);
    await waitFor(() => expect(container.textContent).toContain('Back online'));
    await waitFor(() => expect(container.textContent).toContain('syncing 2 queued events'));
    // Role downgrades from alert to status once connectivity is restored
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
