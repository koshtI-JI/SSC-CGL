import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Megaphone,
  ShieldCheck,
} from 'lucide-react';
import heroArenaImg from '../assets/images/hero_cgl_arena_1794665281724.jpg';
import {
  getAdminCredentialsStatus,
  saveAdminCredentials,
  verifyAdminLogin,
  verifyStudentLogin,
} from '../lib/firestoreService';
import type { ScoringConfig, StudentProfile } from '../types/exam';
import { DEFAULT_PLATFORM_CONFIG, type PlatformConfig } from '../utils/platformConfig';
import { PWAInstallButton } from './PWAInstallButton';
import { ThemeToggleButton } from './ThemeToggleButton';

const RulesGuideModal = lazy(() =>
  import('./RulesGuideModal').then((m) => ({ default: m.RulesGuideModal }))
);

interface AuthGatewayProps {
  routeMode?: 'student' | 'admin_om';
  scoringConfig?: ScoringConfig;
  platformConfig?: PlatformConfig;
  onStudentLogin: (student: StudentProfile) => void;
  onAdminLogin: (adminId: string) => void;
  onBackToStudentHome?: () => void;
}

export const AuthGateway: React.FC<AuthGatewayProps> = ({
  routeMode = 'student',
  scoringConfig,
  platformConfig = DEFAULT_PLATFORM_CONFIG,
  onStudentLogin,
  onAdminLogin,
  onBackToStudentHome,
}) => {
  const isAdminRoute = routeMode === 'admin_om';
  const liveAppName = platformConfig.appName.trim() || DEFAULT_PLATFORM_CONFIG.appName;
  const liveCohortName = platformConfig.cohortName.trim() || DEFAULT_PLATFORM_CONFIG.cohortName;
  const liveBanner = platformConfig.maintenanceBanner.trim();
  const liveOfflineSec = platformConfig.offlineAutoLogoutSec || 60;

  const [studentIdInput, setStudentIdInput] = useState('');
  const [studentPasswordInput, setStudentPasswordInput] = useState('');
  const [showStudentPass, setShowStudentPass] = useState(false);

  const [adminInitialized, setAdminInitialized] = useState<boolean | null>(null);
  const [adminIdInput, setAdminIdInput] = useState('');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [showAdminPass, setShowAdminPass] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  useEffect(() => {
    setShowRulesModal(false);
    setErrorMsg(null);
  }, [routeMode]);

  useEffect(() => {
    if (!isAdminRoute) return;
    let active = true;
    getAdminCredentialsStatus()
      .then((res) => {
        if (!active) return;
        setAdminInitialized(res.initialized);
        if (!res.initialized && !adminIdInput) {
          setAdminIdInput('admin');
        }
      })
      .catch(() => {
        if (!active) return;
        setAdminInitialized(false);
      });
    return () => {
      active = false;
    };
  }, [isAdminRoute]);

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!studentIdInput.trim() || !studentPasswordInput) {
      setErrorMsg('Please enter both your Student ID and Password.');
      return;
    }

    setBusy(true);
    try {
      const res = await verifyStudentLogin(studentIdInput, studentPasswordInput);
      if (!res.ok || !res.student) {
        setErrorMsg(res.error ?? 'Invalid Student ID or Password.');
        return;
      }
      onStudentLogin(res.student);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanId = adminIdInput.trim();
    if (cleanId.length < 2 || adminPasswordInput.length < 4) {
      setErrorMsg('Enter an Admin ID (min 2 chars) and Password (min 4 chars).');
      return;
    }

    setBusy(true);
    try {
      if (adminInitialized) {
        const res = await verifyAdminLogin(cleanId, adminPasswordInput);
        if (!res.ok || !res.adminId) {
          setErrorMsg(res.error ?? 'Invalid Admin ID or Master Password.');
          return;
        }
        onAdminLogin(res.adminId);
      } else {
        if (adminPasswordInput !== adminPasswordConfirm) {
          setErrorMsg('Master Password confirmation does not match.');
          return;
        }
        const savedId = await saveAdminCredentials(cleanId, adminPasswordInput);
        onAdminLogin(savedId);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Admin login failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6f8] dark:bg-[#0b0f17] text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Clean 3-Zone Top Bar */}
      <header className="border-b border-slate-200 dark:border-slate-800/80 bg-[#faf9f6]/95 dark:bg-[#0f141d]/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <a
            href="#top"
            onClick={(e) => e.preventDefault()}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            {liveAppName}
          </a>

          {!isAdminRoute ? (
            <nav
              aria-label="Portal overview"
              className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300"
            >
              <a
                href="#capabilities"
                className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                Capabilities
              </a>
              <button
                type="button"
                onClick={() => setShowRulesModal(true)}
                className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Rules &amp; XP Policy
              </button>
              <a
                href="#student-access"
                className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                Candidate Sign In
              </a>
            </nav>
          ) : (
            <div className="hidden md:block text-sm font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
              Admin Control Gateway
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {!isAdminRoute && (
              <button
                type="button"
                onClick={() => setShowRulesModal(true)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#131924] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <BookOpenText className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
                <span>Exam Policy</span>
              </button>
            )}
            <ThemeToggleButton />
            <PWAInstallButton />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 py-8 sm:px-6 lg:py-12">
        {isAdminRoute ? (
          <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-7 sm:p-8 shadow-sm">
            <form onSubmit={handleAdminSubmit} className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                    {adminInitialized === false
                      ? 'Create Super Admin ID & Password'
                      : 'Admin Control Center'}
                  </h1>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {adminInitialized === false
                      ? 'First-time setup: configure your Admin ID and Master Password.'
                      : 'Sign in with your Admin ID and Master Password to manage the cohort.'}
                  </p>
                </div>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-900 dark:text-red-200"
                >
                  {errorMsg}
                </div>
              )}

              <div>
                <label
                  htmlFor="admin-login-id"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Admin ID
                </label>
                <input
                  id="admin-login-id"
                  type="text"
                  autoComplete="username"
                  value={adminIdInput}
                  onChange={(e) => setAdminIdInput(e.target.value)}
                  placeholder="e.g., admin"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-login-pass"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Master Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="admin-login-pass"
                    type={showAdminPass ? 'text' : 'password'}
                    autoComplete={adminInitialized === false ? 'new-password' : 'current-password'}
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="Minimum 4 characters"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2.5 pr-10 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPass((v) => !v)}
                    aria-label={showAdminPass ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showAdminPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {adminInitialized === false && (
                <div>
                  <label
                    htmlFor="admin-login-confirm"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Confirm Master Password
                  </label>
                  <input
                    id="admin-login-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={adminPasswordConfirm}
                    onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                    placeholder="Re-enter Master Password"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={busy || adminInitialized === null}
                className="inline-flex w-full min-h-[42px] items-center justify-center gap-2 rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                <span>
                  {busy
                    ? 'Verifying...'
                    : adminInitialized === false
                      ? 'Save & Enter Control Center'
                      : 'Login to Admin Control Center'}
                </span>
              </button>

              {onBackToStudentHome && (
                <button
                  type="button"
                  onClick={onBackToStudentHome}
                  className="inline-flex w-full min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#192231] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Return to Student Portal</span>
                </button>
              )}
            </form>
          </div>
        ) : (
          <div className="space-y-8">
            {liveBanner.length > 0 && (
              <div
                role="status"
                className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/35 px-4 py-3 text-xs text-amber-950 dark:text-amber-100"
              >
                <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                <p className="font-medium leading-relaxed">{liveBanner}</p>
              </div>
            )}
            <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
              {/* Left Visual & Editorial Showcase */}
              <section className="order-2 lg:order-1 lg:col-span-7 flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924]">
                <div className="relative h-56 sm:h-72 lg:h-80 w-full overflow-hidden bg-slate-900">
                  {!heroImgFailed ? (
                    <img
                      src={heroArenaImg}
                      alt="Focused SSC CGL study desk with analytical mock performance display"
                      referrerPolicy="no-referrer"
                      onError={() => setHeroImgFailed(true)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-8 text-center">
                      <span className="font-display text-lg font-semibold text-slate-200">
                        {liveAppName} Assessment Arena
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f17]/95 via-[#0b0f17]/70 to-[#0b0f17]/20" />
                  <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 text-white">
                    <p className="text-xs font-medium text-blue-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
                      {liveCohortName} · Tier I &amp; Tier II · Bilingual EN / HI
                    </p>
                    <h1 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl [text-wrap:balance] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                      Precision TCS iON Mock Arena for Serious Aspirants
                    </h1>
                  </div>
                </div>

                <div id="capabilities" className="flex flex-1 flex-col justify-between p-6 sm:p-8">
                  <p className="text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300 max-w-2xl">
                    Zero public signups, zero distractions. Attempt authentic timed mocks with
                    mid-test auto-resume, strict &gt;80% XP discipline, and real-time cohort standings.
                  </p>

                  <dl className="mt-6 grid grid-cols-1 gap-6 border-t border-slate-200 dark:border-slate-800 pt-6 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-semibold text-slate-900 dark:text-white">
                        Zero-Loss Test Resume
                      </dt>
                      <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Every answer, review flag, and remaining second saves continuously so mocks resume without data loss.
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-semibold text-slate-900 dark:text-white">
                        Strict &gt;80% XP &amp; Revision Vault
                      </dt>
                      <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Solve strictly over 80% of questions to unlock XP; skipped or wrong items route into your Revision Vault.
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-semibold text-slate-900 dark:text-white">
                        Camera-Verified Full Mocks
                      </dt>
                      <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Full Tier-I/II simulations verify camera readiness, track tab switches, and include Rough Pad &amp; Calculator.
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-semibold text-slate-900 dark:text-white">
                        Permanent Cohort Backups
                      </dt>
                      <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Attempt logs, subject accuracy trends, and printable scorecards remain permanently preserved.
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>

              {/* Right Student Sign-In Terminal */}
              <section
                id="student-access"
                className="order-1 lg:order-2 lg:col-span-5 flex flex-col justify-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 sm:p-8"
              >
                <div className="space-y-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400">
                      <Lock className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                        Candidate Sign In
                      </h2>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        Enter your assigned cohort Student ID and personal password.
                      </p>
                    </div>
                  </div>

                  {errorMsg && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-900 dark:text-red-200"
                    >
                      {errorMsg}
                    </div>
                  )}

                  <form onSubmit={handleStudentSubmit} className="space-y-4">
                    <div>
                      <label
                        htmlFor="student-login-id"
                        className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                      >
                        Student Login ID
                      </label>
                      <input
                        id="student-login-id"
                        type="text"
                        autoComplete="username"
                        value={studentIdInput}
                        onChange={(e) => setStudentIdInput(e.target.value)}
                        placeholder="e.g., student1 or rahul_cgl"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="student-login-pass"
                        className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                      >
                        Personal Password
                      </label>
                      <div className="relative mt-1.5">
                        <input
                          id="student-login-pass"
                          type={showStudentPass ? 'text' : 'password'}
                          autoComplete="current-password"
                          value={studentPasswordInput}
                          onChange={(e) => setStudentPasswordInput(e.target.value)}
                          placeholder="Enter your password"
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2.5 pr-10 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowStudentPass((v) => !v)}
                          aria-label={showStudentPass ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        >
                          {showStudentPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full min-h-[44px] rounded-lg bg-blue-700 hover:bg-blue-800 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {busy ? 'Checking Credentials...' : 'Enter Student Dashboard'}
                    </button>
                  </form>

                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2 text-xs text-slate-500 dark:text-slate-400">
                    <p>Invite-only access · Tab switching stays signed in; auto-logout triggers if offline continuously for {liveOfflineSec} seconds.</p>
                    <button
                      type="button"
                      onClick={() => setShowRulesModal(true)}
                      className="inline-flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      <BookOpenText className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Read Rules, XP Formula &amp; Camera Policy</span>
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {showRulesModal && (
        <Suspense fallback={null}>
          <RulesGuideModal
            onClose={() => setShowRulesModal(false)}
            scoringConfig={scoringConfig}
          />
        </Suspense>
      )}
    </div>
  );
};
