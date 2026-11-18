import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Save, Trash2, UserCheck, X } from 'lucide-react';
import { updateStudentOwnProfile } from '../lib/firestoreService';
import type { StudentProfile } from '../types/exam';
import { compressAvatarFile } from '../utils/avatarUpload';
import { formatWelcomeTitle } from '../utils/examEngine';

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

interface EditProfileModalProps {
  student: StudentProfile;
  onProfileUpdated: (updated: StudentProfile) => void;
  onClose: () => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  student,
  onProfileUpdated,
  onClose,
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
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const previewWelcome = formatWelcomeTitle(
    targetPost || 'Aspirant',
    displayName || student.displayName
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(false);

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
      setSaveOk(true);
      window.setTimeout(() => {
        onClose();
      }, 450);
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
    try {
      const compressed = await compressAvatarFile(file);
      setAvatarUrl(compressed);
      setAvatarDirty(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not process avatar image.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 p-2 text-blue-700 dark:text-blue-400">
              <UserCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="edit-profile-modal-title"
                className="font-display text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                Edit Profile &amp; Target Position
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Changes update your dashboard welcome header and cohort badge immediately.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close Edit Profile modal"
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Live Welcome Preview */}
        <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/25 p-3.5">
          <div className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">
            Live Dashboard Header Preview
          </div>
          <div className="mt-0.5 font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
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
            <span>Profile saved!</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#11151d] p-3.5">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName || student.displayName}
                className="h-14 w-14 rounded-full object-cover border border-slate-300 dark:border-slate-700 shrink-0"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white font-display text-lg font-bold">
                {(displayName || student.displayName || 'A').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Profile Picture / Avatar
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleAvatarSelected(e)}
                  className="hidden"
                  aria-label="Upload profile avatar"
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

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="modal-display-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Your Name
              </label>
              <input
                id="modal-display-name"
                type="text"
                maxLength={80}
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Om Koshti"
                className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label
                htmlFor="modal-target-post"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Target Position
              </label>
              <input
                id="modal-target-post"
                type="text"
                maxLength={80}
                value={targetPost}
                onChange={(e) => setTargetPost(e.target.value)}
                placeholder="e.g., ASO in MEA, Income Tax Inspector"
                className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
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

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="modal-target-year"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Target Exam Cycle (Optional)
              </label>
              <input
                id="modal-target-year"
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
                htmlFor="modal-city"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                City / Center (Optional)
              </label>
              <input
                id="modal-city"
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
              htmlFor="modal-bio"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Personal Study Focus Note (Optional)
            </label>
            <textarea
              id="modal-bio"
              rows={2}
              maxLength={240}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="e.g., Aiming for 165+ in Tier-I"
              className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 dark:border-slate-800 pt-3.5">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-5 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
