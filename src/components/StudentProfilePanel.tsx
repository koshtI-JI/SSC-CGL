import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  DatabaseBackup,
  Printer,
  Save,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { updateStudentOwnProfile } from '../lib/firestoreService';
import type { ProgressBackupDoc, StudentProfile } from '../types/exam';
import { compressAvatarFile } from '../utils/avatarUpload';
import { formatDateTimeShort, formatWelcomeTitle } from '../utils/examEngine';

const TARGET_POSITION_PRESETS = [
  'ASO in MEA',
  'ASO in CSS',
  'Inspector (Income Tax)',
  'GST & Central Excise Inspector',
  'Preventive Officer',
  'Examiner',
  'AAO / Auditor',
  'Sub-Inspector (CBI)',
];

interface StudentProfilePanelProps {
  student: StudentProfile;
  backupDoc: ProgressBackupDoc | null;
  onProfileUpdated: (updated: StudentProfile) => void;
  onPrintReport: () => void;
  onBack: () => void;
}

export const StudentProfilePanel: React.FC<StudentProfilePanelProps> = ({
  student,
  backupDoc,
  onProfileUpdated,
  onPrintReport,
  onBack,
}) => {
  const [displayName, setDisplayName] = useState(student.displayName);
  const [targetPost, setTargetPost] = useState(student.targetPost);
  const [targetYear, setTargetYear] = useState(student.targetYear ?? 'CGL 2026');
  const [city, setCity] = useState(student.city ?? '');
  const [bio, setBio] = useState(student.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string>(student.avatarDataUrl ?? '');
  const [avatarDirty, setAvatarDirty] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const previewWelcome = formatWelcomeTitle(targetPost || 'Aspirant', displayName || student.displayName);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(null);

    const cleanName = displayName.trim();
    const cleanPost = targetPost.trim();
    if (cleanName.length < 2) {
      setSaveError('Please enter at least 2 characters for your Name.');
      return;
    }
    if (cleanPost.length < 2) {
      setSaveError('Please choose or enter your Target Position (e.g. ASO, Inspector).');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateStudentOwnProfile(student.uid, {
        displayName: cleanName,
        targetPost: cleanPost,
        targetYear: targetYear.trim(),
        city: city.trim(),
        bio: bio.trim(),
        ...(avatarDirty ? { avatarDataUrl: avatarUrl ? avatarUrl : null } : {}),
      });
      onProfileUpdated(updated);
      setAvatarDirty(false);
      setSaveOk('Profile saved! Your dashboard welcome header and cohort badge are now updated.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSaveError(null);
    setSaveOk(null);
    try {
      const compressed = await compressAvatarFile(file);
      setAvatarUrl(compressed);
      setAvatarDirty(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not process avatar image.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Mocks &amp; Tasks</span>
        </button>
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
          Login ID: {student.loginId} · VIP Slot #{student.slotNumber}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Profile Form */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 sm:p-6 space-y-5 lg:col-span-7">
          <div className="flex items-start gap-3">
            <UserCheck className="mt-0.5 h-5 w-5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Candidate Profile &amp; Target Position
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Update your display name and target post. Changes reflect immediately on your
                dashboard header and cohort leaderboard.
              </p>
            </div>
          </div>

          {/* Live Welcome Preview */}
          <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/25 p-4">
            <div className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">
              Live Dashboard Header Preview
            </div>
            <div className="mt-1 font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              {previewWelcome}
            </div>
          </div>

          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-900 dark:text-red-200"
            >
              {saveError}
            </div>
          )}

          {saveOk && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs font-medium text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{saveOk}</span>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#11151d] p-4">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName || student.displayName}
                  className="h-16 w-16 rounded-full object-cover border border-slate-300 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white font-display text-xl font-bold">
                  {(displayName || student.displayName || 'A').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Candidate Profile Photo / Avatar
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Shown in your Dashboard Hero header &amp; Cohort Badge.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handleAvatarSelected(e)}
                    className="hidden"
                    aria-label="Upload candidate profile picture"
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarUrl('');
                        setAvatarDirty(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-800/70 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="profile-display-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Your Display Name
                </label>
                <input
                  id="profile-display-name"
                  type="text"
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g., Om Koshti"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-target-post"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Target Position / Post
                </label>
                <input
                  id="profile-target-post"
                  type="text"
                  maxLength={80}
                  value={targetPost}
                  onChange={(e) => setTargetPost(e.target.value)}
                  placeholder="e.g., ASO, Income Tax Inspector"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                Quick Position Select
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TARGET_POSITION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTargetPost(preset)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer ${
                      targetPost === preset
                        ? 'border-blue-700 bg-blue-700 text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="profile-target-year"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Target Exam Cycle (Optional)
                </label>
                <input
                  id="profile-target-year"
                  type="text"
                  maxLength={24}
                  value={targetYear}
                  onChange={(e) => setTargetYear(e.target.value)}
                  placeholder="e.g., CGL 2026"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-city"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  City / Center (Optional)
                </label>
                <input
                  id="profile-city"
                  type="text"
                  maxLength={80}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g., Prayagraj / New Delhi"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="profile-bio"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Personal Study Note / Focus Goal (Optional)
              </label>
              <textarea
                id="profile-bio"
                rows={2}
                maxLength={240}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="e.g., Aiming for 165+ in Tier-I with 90%+ accuracy in Quant & English"
                className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{saving ? 'Saving Profile...' : 'Save Profile Changes'}</span>
              </button>
            </div>
          </form>
        </section>

        {/* Permanent Progress Backup Vault Card */}
        <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 sm:p-6 space-y-4 lg:col-span-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <DatabaseBackup className="mt-0.5 h-5 w-5 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Indestructible Progress Backup
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  All test scores, question histories, and XP records are backed up automatically across
                  cloud Firestore and browser backup snapshots. Deletion of progress reports is prohibited.
                </p>
              </div>
            </div>

            <dl className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-[#131720] text-xs">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Backup Protection</dt>
                <dd className="font-semibold text-emerald-700 dark:text-emerald-400">
                  Active · Deletion Disabled
                </dd>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Backed Up Mocks (&gt;80%)</dt>
                <dd className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {backupDoc?.testsCompleted ?? 0}
                </dd>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Total Logged Submissions</dt>
                <dd className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {backupDoc?.totalSubmissions ?? 0}
                </dd>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <dt className="text-slate-500 dark:text-slate-400">Last Synced</dt>
                <dd className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                  {backupDoc?.updatedAtMs ? formatDateTimeShort(backupDoc.updatedAtMs) : 'Synced on activity'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={onPrintReport}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 dark:bg-slate-200 px-4 py-2.5 text-xs font-semibold text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Print / Save Official PDF Report</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
