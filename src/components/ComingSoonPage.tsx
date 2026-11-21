import React from 'react';

export const ComingSoonPage: React.FC = () => {
  return (
    <main className="relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-[#f4f6f8] dark:bg-[#0b0f17] px-6 py-16 text-[#0f172a] dark:text-[#f8fafc] selection:bg-[#1e3a8a] selection:text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(30,58,138,0.065),transparent_60%)] dark:bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.11),transparent_58%)]"
      />

      <section
        aria-label="Coming soon announcement"
        className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center text-center"
      >
        <div
          aria-hidden="true"
          className="mb-8 h-[3px] w-14 bg-[#1e3a8a] dark:bg-blue-500"
        />

        <h1 className="font-display text-[clamp(2rem,4.4vw,3.65rem)] font-bold leading-[1.18] tracking-[-0.02em] text-[#0f172a] dark:text-slate-100 [text-wrap:balance]">
          <span className="text-[#1e3a8a] dark:text-blue-400">Path to CGL</span>{' '}
          is coming soon in new form and features
        </h1>

        <div
          aria-hidden="true"
          className="mt-8 h-px w-24 bg-slate-300/90 dark:bg-slate-800"
        />
      </section>
    </main>
  );
};
