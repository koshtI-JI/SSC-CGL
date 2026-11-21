import React from 'react';

export const ComingSoonPage: React.FC = () => {
  return (
    <main className="relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-[#070b14] px-6 py-20 text-slate-50 selection:bg-blue-600 selection:text-white">
      {/* Subtle architectural perspective grid fading into obsidian edge */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.22] bg-[linear-gradient(to_right,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_62%_54%_at_50%_48%,#000_25%,transparent_100%)]"
      />

      {/* Cinematic launch stage ambient lighting */}
      <div
        aria-hidden="true"
        className="launch-aura-primary pointer-events-none absolute left-1/2 top-[44%] h-[34rem] w-[48rem] max-w-[115vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.28)_0%,rgba(56,189,248,0.10)_42%,transparent_72%)] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="launch-aura-secondary pointer-events-none absolute left-[54%] top-[56%] h-[22rem] w-[32rem] max-w-[95vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.11)_0%,rgba(30,64,175,0.12)_48%,transparent_74%)] blur-3xl"
      />

      {/* Delicate floating light motes for launch depth */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="launch-mote-a absolute left-[18%] top-[28%] h-1 w-1 rounded-full bg-sky-300/70 shadow-[0_0_12px_rgba(125,211,252,0.85)]" />
        <span className="launch-mote-b absolute right-[20%] top-[32%] h-1.5 w-1.5 rounded-full bg-blue-400/60 shadow-[0_0_14px_rgba(96,165,250,0.8)]" />
        <span className="launch-mote-c absolute left-[28%] bottom-[26%] h-1 w-1 rounded-full bg-amber-300/60 shadow-[0_0_10px_rgba(252,211,77,0.75)]" />
        <span className="launch-mote-a absolute right-[26%] bottom-[28%] h-1 w-1 rounded-full bg-sky-200/55 shadow-[0_0_10px_rgba(186,230,253,0.7)]" />
      </div>

      <section
        aria-label="Path to CGL 2.0 Launch Announcement"
        className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center"
      >
        {/* Top Luminous Horizon Accent */}
        <div
          aria-hidden="true"
          className="launch-line-expand relative mb-8 h-px w-48 sm:w-64 overflow-hidden bg-gradient-to-r from-transparent via-blue-400/65 to-transparent"
        >
          <span className="launch-beam-glide absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white to-transparent" />
        </div>

        {/* Main Launch Headline — Choreographed Masked Typography */}
        <h1 className="font-display text-[clamp(2.35rem,5.4vw,4.5rem)] font-extrabold leading-[1.09] tracking-[-0.03em] text-white [text-wrap:balance]">
          <span className="block overflow-hidden pb-1.5">
            <span className="launch-mask-rise-1 inline-block">
              Path to CGL{' '}
              <span className="launch-version-sheen inline-block">2.0</span>
            </span>
          </span>
          <span className="block overflow-hidden pb-2">
            <span className="launch-mask-rise-2 inline-block text-slate-100/95">
              is Coming Soon
            </span>
          </span>
        </h1>

        {/* Subtext — Staggered Editorial Reveal */}
        <p className="mt-7 max-w-2xl text-[clamp(1.05rem,1.9vw,1.35rem)] font-normal leading-[1.65] tracking-[-0.01em] text-slate-300 [text-wrap:balance]">
          <span className="launch-fade-up-1 inline-block font-medium text-white">
            Naya look.
          </span>{' '}
          <span className="launch-fade-up-2 inline-block font-medium text-sky-200">
            Naye features.
          </span>{' '}
          <span className="launch-fade-up-3 inline-block text-slate-300/95">
            Aur zyada smart SSC CGL preparation — jald aa raha hai.
          </span>
        </p>

        {/* Bottom Architectural Light Rule */}
        <div
          aria-hidden="true"
          className="launch-line-expand-late relative mt-11 h-px w-36 sm:w-48 overflow-hidden bg-gradient-to-r from-transparent via-slate-600/80 to-transparent"
        >
          <span className="launch-beam-glide absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-sky-300/90 to-transparent" />
        </div>
      </section>
    </main>
  );
};
