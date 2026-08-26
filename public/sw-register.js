/**
 * Satnam service-worker registration bootstrap.
 *
 * A-4 fix (2026-08-25): moved OUT of an inline <script> in index.html.
 * The declared CSP script-src 'self' 'wasm-unsafe-eval' admits neither
 * inline scripts nor hashes, so the old inline bootstrap was silently
 * blocked wherever the header is enforced — killing PWA/offline/background
 * sync registration. This file is served same-origin ('self') and loads
 * cleanly under the existing policy. No business logic lives here.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(function (registration) {
        // Listen for SW updates and notify the React app
        registration.addEventListener('updatefound', function () {
          var newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // Dispatch a custom event that the React app can listen for
              window.dispatchEvent(new CustomEvent('swUpdateAvailable'));
            }
          });
        });
      })
      .catch(function (err) {
        // SW registration failure is non-fatal — the app works without it
        console.warn('Service Worker registration failed:', err);
      });
  });
}
