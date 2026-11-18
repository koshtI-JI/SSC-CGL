import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  createNewVipUser,
  deleteVipInvite,
  saveAdminCredentials,
  syncPendingLocalOpsToCloud,
  updateVipUser,
} from '../lib/firestoreService';
import type {
  LeaderboardEntry,
  StudentPresenceDoc,
  StudentProfile,
  TestAttemptDoc,
  VipInvite,
} from '../types/exam';
import {
  buildAdminUserManagementRows,
  buildScopedDataExport,
  filterAdminUserRows,
  findDuplicateSlotConflicts,
  findNextAvailableSlot,
  inspectLegacyPlaintextInvites,
  parseAndValidateScopedImport,
  type CanonicalAdminUserRow,
  type DataPortabilityScope,
} from '../utils/adminCommandCenter';
import { formatDateTimeShort } from '../utils/examEngine';

interface AdminUserManagementTabProps {
  adminEmail: string;
  invites: VipInvite[];
  invitesLoaded?: boolean;
  students: StudentProfile[];
  leaderboard: LeaderboardEntry[];
  attempts: TestAttemptDoc[];
  presences: StudentPresenceDoc[];
  pendingSyncCount: number;
  onAdminIdUpdated?: (nextAdminId: string) => void;
  onOpenAiSettings?: () => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}

export const AdminUserManagementTab: React.FC<AdminUserManagementTabProps> = ({
  adminEmail,
  invites,
  invitesLoaded = true,
  students,
  leaderboard,
  attempts,
  presences,
  pendingSyncCount,
  onAdminIdUpdated,
  onOpenAiSettings,
  onNotify,
}) => {
  const canonicalRows = useMemo(
    () =>
      buildAdminUserManagementRows({
        invites,
        students,
        leaderboard,
        attempts,
        presences,
      }),
    [invites, students, leaderboard, attempts, presences]
  );

  const slotConflicts = useMemo(
    () => findDuplicateSlotConflicts(canonicalRows),
    [canonicalRows]
  );

  const legacyAudit = useMemo(() => inspectLegacyPlaintextInvites(invites), [invites]);

  const [editingRow, setEditingRow] = useState<CanonicalAdminUserRow | null>(null);
  const [vipBusy, setVipBusy] = useState(false);
  const [slotNumber, setSlotNumber] = useState<number>(() => findNextAvailableSlot(canonicalRows));
  const [inviteLoginId, setInviteLoginId] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePost, setInvitePost] = useState('ASO in MEA');
  const [invitePassword, setInvitePassword] = useState('');
  const [showDraftPassword, setShowDraftPassword] = useState(false);
  const [lastProvisionNotice, setLastProvisionNotice] = useState<{
    loginId: string;
    slotNumber: number;
    action: 'created' | 'updated';
    passwordUpdated: boolean;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked'>('all');
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

  const [newAdminId, setNewAdminId] = useState(adminEmail);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const [portabilityScope, setPortabilityScope] = useState<DataPortabilityScope>('full_cohort');
  const snapshotInputRef = useRef<HTMLInputElement | null>(null);

  const filteredRows = useMemo(
    () => filterAdminUserRows(canonicalRows, searchQuery, statusFilter),
    [canonicalRows, searchQuery, statusFilter]
  );

  const handleSelectEditRow = (row: CanonicalAdminUserRow) => {
    setEditingRow(row);
    setSlotNumber(row.slotNumber);
    setInviteName(row.displayName);
    setInviteLoginId(row.loginId);
    setInvitePost(row.targetPost);
    setInvitePassword('');
    setShowDraftPassword(false);
    setConfirmDeleteUid(null);
  };

  const handleCancelEdit = () => {
    setEditingRow(null);
    setInviteLoginId('');
    setInviteName('');
    setInvitePost('ASO in MEA');
    setInvitePassword('');
    setShowDraftPassword(false);
    setSlotNumber(findNextAvailableSlot(canonicalRows));
  };

  const handleCreateOrSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRow) {
      await handleUpdateUser();
      return;
    }
    const cleanLoginId = inviteLoginId.trim().toLowerCase();
    if (cleanLoginId.length < 2 || !inviteName.trim()) {
      onNotify('err', 'Student Login ID (min 2 chars) and display name are required.');
      return;
    }
    if (invitePassword.trim().length < 4) {
      onNotify('err', 'Personal password must be at least 4 characters for new entries.');
      return;
    }
    setVipBusy(true);
    try {
      await createNewVipUser({
        loginId: cleanLoginId,
        displayName: inviteName,
        targetPost: invitePost || 'ASO in MEA',
        slotNumber,
        active: true,
        password: invitePassword.trim(),
      });

      onNotify('ok', `New VIP user "${cleanLoginId}" created in Slot #${slotNumber} (SHA-256 hashed).`);
      setLastProvisionNotice({
        loginId: cleanLoginId,
        slotNumber,
        action: 'created',
        passwordUpdated: true,
      });
      setInviteLoginId('');
      setInviteName('');
      setInvitePassword('');
      setShowDraftPassword(false);
      setSlotNumber(findNextAvailableSlot(canonicalRows));
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Failed to create VIP Student ID.');
    } finally {
      setVipBusy(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!editingRow) return;
    const cleanLoginId = inviteLoginId.trim().toLowerCase();
    if (cleanLoginId.length < 2 || !inviteName.trim()) {
      onNotify('err', 'Student Login ID (min 2 chars) and display name are required.');
      return;
    }
    const trimmedPass = invitePassword.trim();
    if (trimmedPass.length > 0 && trimmedPass.length < 4) {
      onNotify('err', 'New password must be at least 4 characters (or leave blank to keep existing).');
      return;
    }
    const targetId = editingRow.inviteId || editingRow.uid;
    setVipBusy(true);
    try {
      await updateVipUser(targetId, {
        loginId: cleanLoginId,
        displayName: inviteName,
        targetPost: invitePost || 'ASO in MEA',
        slotNumber,
        active: editingRow.active,
        password: trimmedPass || undefined,
      });
      onNotify(
        'ok',
        `Updated "${inviteName.trim()}" (UID: ${targetId}, Login ID: ${cleanLoginId}).`
      );
      setLastProvisionNotice({
        loginId: cleanLoginId,
        slotNumber,
        action: 'updated',
        passwordUpdated: trimmedPass.length >= 4,
      });
      handleCancelEdit();
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Failed to update VIP user.');
    } finally {
      setVipBusy(false);
    }
  };

  const handleToggleActive = async (row: CanonicalAdminUserRow) => {
    const targetId = row.inviteId || row.uid;
    try {
      await updateVipUser(targetId, {
        loginId: row.loginId,
        displayName: row.displayName,
        targetPost: row.targetPost,
        slotNumber: row.slotNumber,
        active: !row.active,
      });
      onNotify(
        'ok',
        `${row.displayName} (${row.loginId}) is now ${!row.active ? 'Active' : 'Revoked'}. All historical attempts & XP are preserved.`
      );
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Failed to toggle student status.');
    }
  };

  const handleConfirmDelete = async (row: CanonicalAdminUserRow) => {
    const targetId = row.inviteId || row.uid;
    try {
      if (editingRow?.uid === row.uid) {
        handleCancelEdit();
      }
      await deleteVipInvite(targetId);
      setConfirmDeleteUid(null);
      onNotify('ok', `Removed VIP invite for ${row.displayName} (${row.loginId}).`);
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Failed to remove VIP student.');
    }
  };

  const handleUpdateAdminCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newAdminId.trim().length < 2 || newAdminPassword.length < 4) {
      onNotify('err', 'Admin ID must be at least 2 chars and Master Password at least 4 chars.');
      return;
    }
    try {
      const savedId = await saveAdminCredentials(newAdminId, newAdminPassword);
      onAdminIdUpdated?.(savedId);
      setNewAdminPassword('');
      onNotify('ok', `Super Admin login updated (ID: ${savedId}).`);
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Could not update Admin credentials.');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-5 lg:col-span-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              5-Member VIP Student IDs
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Canonical accounts merged by immutable UID. Passwords are stored as SHA-256 hashes only.
            </p>
          </div>
          <Users className="h-5 w-5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
        </div>

        {slotConflicts.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/35 px-4 py-3 text-xs text-amber-950 dark:text-amber-200 space-y-1"
          >
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
              <span>Duplicate Slot Assignment Detected</span>
            </div>
            {slotConflicts.map((c) => (
              <p key={c.slotNumber}>
                Slot #{c.slotNumber} is currently shared by{' '}
                <span className="font-mono font-semibold">{c.loginIds.join(', ')}</span>. Edit one user to assign a free slot.
              </p>
            ))}
          </div>
        )}

        {editingRow && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs">
            <span className="font-semibold text-amber-950 dark:text-amber-200">
              Editing User: {editingRow.displayName} · UID:{' '}
              <span className="font-mono">{editingRow.uid}</span> · Login:{' '}
              <span className="font-mono">{editingRow.loginId}</span>
            </span>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="inline-flex items-center gap-1 font-semibold text-amber-900 dark:text-amber-200 hover:underline cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Cancel Edit</span>
            </button>
          </div>
        )}

        <form onSubmit={handleCreateOrSubmitUser} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="vip-slot" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              VIP Slot (1–5)
            </label>
            <select
              id="vip-slot"
              value={slotNumber}
              onChange={(e) => setSlotNumber(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  Slot #{n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="vip-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Student Full Name
            </label>
            <input
              id="vip-name"
              type="text"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="e.g., Aarav Sharma"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="vip-login-id" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Student Login ID (Username)
            </label>
            <input
              id="vip-login-id"
              type="text"
              value={inviteLoginId}
              onChange={(e) => setInviteLoginId(e.target.value)}
              placeholder="e.g., damini_888 or demo@123"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="vip-post" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Target SSC CGL Post
            </label>
            <input
              id="vip-post"
              type="text"
              value={invitePost}
              onChange={(e) => setInvitePost(e.target.value)}
              placeholder="Income Tax Inspector"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="vip-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {editingRow
                  ? 'Reset Password (optional — leave blank to keep existing hash)'
                  : 'Set Personal Password (min 4 chars · hashed on save)'}
              </label>
              <button
                type="button"
                onClick={() => {
                  const rand = `CGL@${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.floor(100 + Math.random() * 899)}`;
                  setInvitePassword(rand);
                  setShowDraftPassword(true);
                }}
                className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Generate Temporary Password
              </button>
            </div>
            <div className="relative mt-1">
              <input
                id="vip-password"
                type={showDraftPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                placeholder={
                  editingRow
                    ? 'Leave blank to preserve current password hash'
                    : 'Enter personal password for this student'
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 pr-10 font-mono text-sm text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                aria-label={showDraftPassword ? 'Hide draft password input' : 'Show draft password input'}
                onClick={() => setShowDraftPassword((v) => !v)}
                className="absolute inset-y-0 right-2 flex items-center px-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                {showDraftPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2.5">
            {!editingRow ? (
              <button
                type="submit"
                disabled={vipBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{vipBusy ? 'Creating...' : 'Create User'}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={vipBusy}
                  onClick={() => void handleUpdateUser()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  <span>{vipBusy ? 'Updating...' : 'Update User'}</span>
                </button>
                <button
                  type="button"
                  disabled={vipBusy}
                  onClick={handleCancelEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Cancel</span>
                </button>
              </>
            )}
          </div>
        </form>

        {lastProvisionNotice && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 text-xs flex items-start justify-between gap-3">
            <div>
              <strong className="text-slate-900 dark:text-slate-100">
                VIP Slot #{lastProvisionNotice.slotNumber} {lastProvisionNotice.action === 'created' ? 'Created' : 'Updated'}
              </strong>
              <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                Login ID: <span className="font-mono font-semibold">{lastProvisionNotice.loginId}</span>
                {lastProvisionNotice.passwordUpdated
                  ? ' · New SHA-256 credential hash saved (plaintext is never stored or displayed).'
                  : ' · Existing password hash preserved.'}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss credential notice"
              onClick={() => setLastProvisionNotice(null)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Roster Controls: Search & Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-t border-slate-200 dark:border-slate-800 pt-4">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, login ID, UID, or target post..."
              aria-label="Search cohort users"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {(['all', 'active', 'revoked'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-md px-2.5 py-1.5 font-semibold capitalize transition-colors cursor-pointer ${
                  statusFilter === status
                    ? 'bg-blue-700 text-white'
                    : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Canonical Cohort Roster */}
        {!invitesLoaded && canonicalRows.length === 0 ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading VIP cohort roster from Firestore &amp; local cache...
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-3">
            {canonicalRows.length === 0
              ? '0 VIP Student IDs created yet. Add up to 5 students above.'
              : 'No cohort accounts match your current search or filter.'}
          </p>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3">Slot</th>
                    <th className="py-2 pr-3">Aspirant</th>
                    <th className="py-2 pr-3">Login ID &amp; UID</th>
                    <th className="py-2 pr-3">Progress &amp; Credentials</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {filteredRows.map((row) => {
                    const isSelected = editingRow?.uid === row.uid;
                    const confirmingDelete = confirmDeleteUid === row.uid;
                    return (
                      <tr key={row.uid} className={isSelected ? 'bg-blue-50/70 dark:bg-blue-950/25' : ''}>
                        <td className="py-2.5 pr-3 align-top">
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            #{row.slotNumber}
                          </span>
                          {row.slotConflictWith.length > 0 && (
                            <div className="mt-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                              Slot shared
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 align-top">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {row.displayName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.targetPost}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                            {row.updatedAtMs > 0 ? `Updated ${formatDateTimeShort(row.updatedAtMs)}` : 'No recent edits'}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 align-top">
                          <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {row.loginId}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            UID: {row.uid}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 align-top">
                          <div className="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-400 tabular-nums">
                            {row.totalXp} XP · {row.testsAttempted} tests
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span
                              className={
                                row.presenceStatus === 'in_exam'
                                  ? 'font-semibold text-amber-700 dark:text-amber-400'
                                  : row.presenceStatus === 'online'
                                    ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                    : 'text-slate-500 dark:text-slate-400'
                              }
                            >
                              {row.presenceStatus === 'in_exam'
                                ? 'In Exam'
                                : row.presenceStatus === 'online'
                                  ? 'Online'
                                  : 'Offline'}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {row.hasPasswordHash ? 'Hash Ready' : 'Needs Password'}
                            </span>
                            {row.legacyPlaintextDetected && (
                              <span
                                title="Legacy Firestore document still contains a deprecated plaintext field; saving/resetting updates it cleanly."
                                className="rounded bg-amber-100 dark:bg-amber-950/60 px-1 py-0.5 font-semibold text-amber-800 dark:text-amber-300"
                              >
                                Legacy field on remote
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 align-top">
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(row)}
                            className={`text-xs font-semibold underline cursor-pointer ${
                              row.active
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {row.active ? 'Active' : 'Revoked'}
                          </button>
                        </td>
                        <td className="py-2.5 text-right align-top">
                          {confirmingDelete ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleConfirmDelete(row)}
                                className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 cursor-pointer"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUid(null)}
                                className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                Keep
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => handleSelectEditRow(row)}
                                className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-2 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
                              >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${row.displayName}`}
                                onClick={() => setConfirmDeleteUid(row.uid)}
                                className="text-slate-500 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4 inline" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {filteredRows.map((row) => {
                const confirmingDelete = confirmDeleteUid === row.uid;
                return (
                  <div
                    key={row.uid}
                    className={`rounded-lg border p-3.5 text-xs space-y-2 ${
                      editingRow?.uid === row.uid
                        ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11151d]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          #{row.slotNumber} · {row.displayName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {row.targetPost}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(row)}
                        className={`text-xs font-semibold underline cursor-pointer ${
                          row.active
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {row.active ? 'Active' : 'Revoked'}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                      Login: {row.loginId} · UID: {row.uid}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                      <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                        {row.totalXp} XP · {row.testsAttempted} tests
                      </span>
                      <span>{row.hasPasswordHash ? 'SHA-256 Active' : 'Needs Password'}</span>
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleSelectEditRow(row)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 font-semibold text-blue-700 dark:text-blue-400 cursor-pointer"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      {confirmingDelete ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleConfirmDelete(row)}
                            className="rounded bg-red-600 px-2.5 py-1 font-semibold text-white cursor-pointer"
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUid(null)}
                            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteUid(row.uid)}
                          className="rounded border border-red-200 dark:border-red-900/50 px-2.5 py-1 font-semibold text-red-700 dark:text-red-400 cursor-pointer"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <aside className="space-y-6 lg:col-span-5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Credential Containment &amp; Dry-Run Audit
            </h3>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Plaintext passwords are never written, displayed, copied, or exported by this panel. Only SHA-256 hashes are used for login verification.
          </p>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11151d] p-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">Loaded VIP Accounts</span>
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{legacyAudit.totalInvites}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-400">Remote records with legacy field (dry-run)</span>
              <span
                className={`font-mono font-bold ${
                  legacyAudit.affectedCount > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {legacyAudit.affectedCount}
              </span>
            </div>
            {legacyAudit.affectedCount > 0 && (
              <p className="pt-1 text-[11px] text-amber-800 dark:text-amber-300">
                Affected UIDs: <span className="font-mono">{legacyAudit.affectedUids.join(', ')}</span>. See Owner Actions doc to strip deprecated fields safely in Firestore.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-3">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            Direct ID + Password Access
          </h3>
          <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <li>
              Assign a free Slot (#1–#5), Student Name, Login ID (such as{' '}
              <span className="font-mono text-slate-800 dark:text-slate-100">damini_888</span>), and password on the left.
            </li>
            <li>
              Share the new temporary password privately right when you set it — stored credentials are one-way SHA-256 hashed.
            </li>
            <li>
              Pause or revoke access anytime via <strong>Active</strong> in the roster table without losing any mock attempts, XP, or revision items.
            </li>
          </ol>
        </div>

        <form
          onSubmit={handleUpdateAdminCredentials}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-3"
        >
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Update Admin ID &amp; Master Password
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Credentials used to sign in via the restricted /om Admin Gateway.
          </p>
          <input
            type="text"
            value={newAdminId}
            onChange={(e) => setNewAdminId(e.target.value)}
            placeholder="Admin Login ID (min 2 chars)"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <input
            type="password"
            value={newAdminPassword}
            onChange={(e) => setNewAdminPassword(e.target.value)}
            placeholder="New Master Password (min 4 chars)"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 cursor-pointer"
          >
            Update Admin Credentials
          </button>
        </form>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                1-Click Data Portability &amp; Cloud Sync
              </h3>
            </div>
            <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">
              {pendingSyncCount} pending
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Export or restore cohort progress, attempts, and question banks as sanitized JSON backups (credentials &amp; password hashes are excluded).
          </p>
          <div>
            <label
              htmlFor="portability-scope"
              className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400"
            >
              Export Scope
            </label>
            <select
              id="portability-scope"
              value={portabilityScope}
              onChange={(e) => setPortabilityScope(e.target.value as DataPortabilityScope)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              <option value="full_cohort">Full Platform Snapshot (Students + Questions + Mocks)</option>
              <option value="students_attempts">Students, Attempts &amp; Revision Vaults Only</option>
              <option value="questions_mocks">Question Bank, Mocks &amp; Scoring Formula Only</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const snap = buildScopedDataExport(portabilityScope);
                const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `getcgl-${portabilityScope}-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                onNotify('ok', `Downloaded sanitized "${portabilityScope}" backup JSON.`);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export Backup JSON</span>
            </button>
            <input
              ref={snapshotInputRef}
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const text = await file.text();
                  const res = parseAndValidateScopedImport(text);
                  onNotify('ok', `Imported ${res.importedRecords} records from "${file.name}" (credentials protected).`);
                } catch (err) {
                  onNotify('err', err instanceof Error ? err.message : 'Invalid backup JSON file.');
                }
              }}
              className="hidden"
              aria-label="Import Backup JSON"
            />
            <button
              type="button"
              onClick={() => snapshotInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import Backup JSON</span>
            </button>
            <button
              type="button"
              disabled={cloudSyncBusy || pendingSyncCount === 0}
              onClick={async () => {
                setCloudSyncBusy(true);
                try {
                  const res = await syncPendingLocalOpsToCloud();
                  if (res.quotaBlocked) {
                    onNotify('err', `Cloud quota still exhausted (${res.synced} synced, ${res.remaining} queued locally).`);
                  } else {
                    onNotify('ok', `Synced ${res.synced} local records to Firestore (${res.remaining} remaining).`);
                  }
                } finally {
                  setCloudSyncBusy(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${cloudSyncBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{cloudSyncBusy ? 'Syncing...' : 'Retry Cloud Sync'}</span>
            </button>
            {onOpenAiSettings && (
              <button
                type="button"
                onClick={onOpenAiSettings}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs font-semibold text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/50 cursor-pointer"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                <span>AI Engine Config</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
