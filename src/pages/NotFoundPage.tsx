/**
 * Satnam v2 — 404 Not Found Page
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <>
      <Helmet>
        <title>Satnam — Page Not Found</title>
      </Helmet>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <p className="text-8xl font-bold text-[#2a2a2a] font-mono">404</p>
        <h1 className="heading-display text-2xl text-[#f5f5f5]">Page Not Found</h1>
        <p className="text-[#a0a0a0] text-center max-w-sm">
          This route does not exist. Check the URL or return to the dashboard.
        </p>
        <Link to="/" className="btn-primary no-underline">
          Back to Dashboard
        </Link>
      </main>
    </>
  );
}
