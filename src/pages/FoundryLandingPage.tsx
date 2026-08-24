/**
 * CR-G — Group Foundry landing page (v2 routing adaptation).
 *
 * Assembles founder-authored copy from src/content/ per R6 manifest verdicts:
 * hero (verbatim), Foundry headline (verbatim governing lines under the
 * "Group Foundry" surface), tetrahedron framing, Wealth Codes verbatim,
 * Namaste` Moore attribution, verified landing videos.
 *
 * ALL copy routes to founder proofread before any public release — this page
 * renders from content modules so proofreading has a single source.
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import {
  ATTRIBUTION,
  FOUNDRY,
  HERO,
  LANDING_VIDEOS,
  TETRAHEDRON,
} from '../content/foundry';
import { WEALTH_CODES } from '../content/wealth-codes';

function renderEmphasis(text: string): React.JSX.Element[] {
  // Wealth Code bodies use **bold** markers preserved from v1 <strong> spans.
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return (
      <p key={i} className="text-royal-100 leading-relaxed mb-4 text-lg">
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={j} className="text-white">
              {part.slice(2, -2)}
            </strong>
          ) : (
            <React.Fragment key={j}>{part}</React.Fragment>
          ),
        )}
      </p>
    );
  });
}

export default function FoundryLandingPage(): React.JSX.Element {
  return (
    <>
      <Helmet>
        <title>Satnam — {HERO.title}</title>
        <meta name="description" content={FOUNDRY.subhead} />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-royal-950 via-slate-950 to-black text-white">
        {/* ── Hero ── */}
        <section className="px-4 pt-20 pb-16 text-center">
          <h1 className="font-display text-5xl md:text-7xl font-bold mb-6 leading-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-400 to-gold-300">
              {HERO.title}
            </span>
          </h1>
          {/* VERBATIM v1 subhead */}
          <h2 className="text-2xl md:text-3xl font-semibold text-royal-200 mb-8">
            {HERO.subtitle}
          </h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              to="/auth?mode=generate"
              className="bg-gradient-to-r from-gold-500 to-gold-400 hover:from-gold-600 hover:to-gold-500 text-white font-semibold py-3 px-8 rounded-lg transition-all"
            >
              Generate Identity
            </Link>
            <Link
              to="/auth"
              className="bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white font-semibold py-3 px-8 rounded-lg transition-all"
            >
              Sign In
            </Link>
          </div>
        </section>

        {/* ── Group Foundry headline ── */}
        <section className="max-w-5xl mx-auto px-4 pb-16 text-center">
          <h2 className="font-display text-3xl md:text-5xl font-bold leading-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-400 to-gold-300">
              {FOUNDRY.headlineLine1}
            </span>
            <br />
            <span className="text-royal-400">{FOUNDRY.headlineLine2}</span>
          </h2>
          <p className="mt-6 text-xl md:text-2xl text-royal-100 max-w-3xl mx-auto">
            {FOUNDRY.subhead}
          </p>
        </section>

        {/* ── Tetrahedron four faces ── */}
        <section className="max-w-5xl mx-auto px-4 pb-16 text-center">
          <h2 className="font-display text-4xl font-bold mb-4">{TETRAHEDRON.heading}</h2>
          <p className="text-xl text-royal-200 mb-2">{TETRAHEDRON.subheading}</p>
          <p className="text-lg text-royal-300 italic">{TETRAHEDRON.note}</p>
        </section>

        {/* ── Multigenerational Wealth Codes (VERBATIM per founder verdict) ── */}
        <section className="max-w-5xl mx-auto px-4 pb-16">
          <div className="rounded-2xl border border-royal-800/40 bg-gradient-to-br from-royal-900/50 to-slate-900/50 p-8 md:p-12 backdrop-blur-sm">
            <div className="text-center mb-12">
              <h2 className="font-display text-4xl font-bold mb-4">
                The Multigenerational Wealth Codes
              </h2>
              <p className="text-xl text-royal-200">
                Ancient wisdom for modern family sovereignty
              </p>
            </div>

            {WEALTH_CODES.map((code) => (
              <article
                key={code.title}
                className="mb-12 rounded-xl border border-white/10 bg-white/5 p-8 last:mb-0"
              >
                <h3 className="text-3xl font-bold text-gold-400 mb-6">{code.title}</h3>
                {renderEmphasis(code.body)}
              </article>
            ))}

            {/* Namaste` Moore attribution — verbatim incl. backtick */}
            <div className="pt-6 mt-8 border-t border-white/10 text-center">
              <p className="text-sm text-royal-300 italic mb-2">{ATTRIBUTION.byline}</p>
              <a
                href={ATTRIBUTION.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold-400 hover:text-gold-300 transition-colors text-sm font-semibold"
              >
                {ATTRIBUTION.linkText}
              </a>
            </div>
          </div>
        </section>

        {/* ── Landing videos (verified live 2026-08-24) ── */}
        <section className="max-w-7xl mx-auto px-4 pb-24">
          <div className="grid gap-6 md:grid-cols-3">
            {LANDING_VIDEOS.map((video) => (
              <a
                key={video.id}
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Watch ${video.caption} on YouTube`}
                className="group rounded-xl border border-white/20 bg-white/10 p-5 shadow-lg backdrop-blur-sm transition-transform hover:scale-[1.02]"
              >
                <img
                  src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                  alt={video.caption}
                  loading="lazy"
                  className="mb-3 aspect-video w-full rounded-lg object-cover"
                />
                <p className="text-center text-sm font-medium text-white group-hover:text-gold-300">
                  {video.caption}
                </p>
              </a>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
