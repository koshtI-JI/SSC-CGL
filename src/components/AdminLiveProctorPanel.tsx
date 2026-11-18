import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CameraOff,
  Eye,
  MonitorCheck,
  RefreshCw,
  Video,
  VideoOff,
} from 'lucide-react';
import {
  addProctorCandidate,
  endProctorWatch,
  publishProctorAnswer,
  requestProctorWatch,
  subscribeProctorCandidates,
  subscribeProctorRoom,
} from '../lib/firestoreService';
import type { StudentPresenceDoc, StudentProfile, VipInvite } from '../types/exam';
import { formatLastSeen, isPresenceOnline } from '../utils/examEngine';
import { isRealCohortStudentUid } from '../utils/sessionAndOverrides';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

interface AdminLiveProctorPanelProps {
  adminUid: string;
  invites: VipInvite[];
  students: StudentProfile[];
  presences: StudentPresenceDoc[];
}

export const AdminLiveProctorPanel: React.FC<AdminLiveProctorPanelProps> = ({
  adminUid,
  invites,
  students,
  presences,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [watchingUid, setWatchingUid] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rtcStatus, setRtcStatus] = useState<'idle' | 'requesting' | 'negotiating' | 'live' | 'fallback'>('idle');
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [relayFrame, setRelayFrame] = useState<{ dataUrl: string; atMs: number } | null>(null);

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const disconnectFallbackTimerRef = useRef<number | null>(null);
  const roomUnsubRef = useRef<(() => void) | null>(null);
  const candUnsubRef = useRef<(() => void) | null>(null);
  const handledOfferSessionRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const watchingSessionRef = useRef<{ uid: string; sessionId: string } | null>(null);

  // Tick every 1s while watching a live stream so live status & frame age stay crisp
  useEffect(() => {
    const interval = watchingUid ? 1000 : 3000;
    const t = window.setInterval(() => setNowMs(Date.now()), interval);
    return () => window.clearInterval(t);
  }, [watchingUid]);

  // Bind remote WebRTC MediaStream once <video> is mounted (never stall on display:none)
  useEffect(() => {
    const video = remoteVideoRef.current;
    const stream = remoteStreamRef.current;
    if (video && stream && hasRemoteStream) {
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      void video.play().catch(() => {});
    }
  }, [hasRemoteStream, watchingUid]);

  const cleanupViewer = () => {
    if (disconnectFallbackTimerRef.current !== null) {
      window.clearTimeout(disconnectFallbackTimerRef.current);
      disconnectFallbackTimerRef.current = null;
    }
    if (roomUnsubRef.current) {
      roomUnsubRef.current();
      roomUnsubRef.current = null;
    }
    if (candUnsubRef.current) {
      candUnsubRef.current();
      candUnsubRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    remoteStreamRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    handledOfferSessionRef.current = null;
    pendingCandidatesRef.current = [];
    setHasRemoteStream(false);
    setRelayFrame(null);
    setRtcStatus('idle');
  };

  useEffect(() => {
    return () => {
      cleanupViewer();
      const activeWatch = watchingSessionRef.current;
      watchingSessionRef.current = null;
      if (activeWatch) {
        void endProctorWatch(activeWatch.uid, activeWatch.sessionId).catch(() => {});
      }
    };
  }, []);

  const handleStartWatch = async (targetUid: string) => {
    const prevWatch = watchingSessionRef.current;
    if (prevWatch) {
      watchingSessionRef.current = null;
      void endProctorWatch(prevWatch.uid, prevWatch.sessionId).catch(() => {});
    }
    cleanupViewer();
    setWatchingUid(targetUid);
    setRtcStatus('requesting');

    const newSessionId = await requestProctorWatch(targetUid, adminUid);
    setSessionId(newSessionId);
    watchingSessionRef.current = { uid: targetUid, sessionId: newSessionId };

    if (typeof RTCPeerConnection === 'undefined') {
      setRtcStatus('fallback');
      return;
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.ontrack = (evt) => {
      const stream = evt.streams?.[0] ?? new MediaStream([evt.track]);
      remoteStreamRef.current = stream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        void remoteVideoRef.current.play().catch(() => {});
      }
      setHasRemoteStream(true);
      setRtcStatus('live');
    };

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        void addProctorCandidate(
          targetUid,
          newSessionId,
          'admin',
          JSON.stringify(evt.candidate)
        ).catch(() => {});
      }
    };

    const handleConnectionChange = () => {
      const state = pc.connectionState;
      const ice = pc.iceConnectionState;
      if (state === 'connected' || ice === 'connected' || ice === 'completed') {
        if (disconnectFallbackTimerRef.current !== null) {
          window.clearTimeout(disconnectFallbackTimerRef.current);
          disconnectFallbackTimerRef.current = null;
        }
        if (remoteStreamRef.current) setHasRemoteStream(true);
        setRtcStatus('live');
      } else if (state === 'failed' || state === 'closed' || ice === 'failed' || ice === 'closed') {
        setHasRemoteStream(false);
        setRtcStatus('fallback');
      } else if (state === 'disconnected' || ice === 'disconnected') {
        if (disconnectFallbackTimerRef.current === null) {
          disconnectFallbackTimerRef.current = window.setTimeout(() => {
            disconnectFallbackTimerRef.current = null;
            if (pcRef.current === pc && pc.connectionState !== 'connected') {
              setHasRemoteStream(false);
              setRtcStatus('fallback');
              try {
                pc.restartIce?.();
              } catch {
                // Ignore if unsupported
              }
            }
          }, 2500);
        }
      }
    };

    pc.onconnectionstatechange = handleConnectionChange;
    pc.oniceconnectionstatechange = handleConnectionChange;

    candUnsubRef.current = subscribeProctorCandidates(
      targetUid,
      newSessionId,
      'student',
      (cand) => {
        try {
          const parsed = JSON.parse(cand.candidateJson) as RTCIceCandidateInit;
          if (pc.remoteDescription) {
            void pc.addIceCandidate(new RTCIceCandidate(parsed)).catch(() => {});
          } else {
            pendingCandidatesRef.current.push(parsed);
          }
        } catch {
          // Ignore malformed candidate
        }
      }
    );

    roomUnsubRef.current = subscribeProctorRoom(targetUid, async (room) => {
      if (!room || room.sessionId !== newSessionId) return;
      if (
        room.status === 'offer_ready' &&
        room.offerSdp &&
        handledOfferSessionRef.current !== newSessionId
      ) {
        handledOfferSessionRef.current = newSessionId;
        setRtcStatus('negotiating');
        try {
          const offer = JSON.parse(room.offerSdp) as RTCSessionDescriptionInit;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const queued = pendingCandidatesRef.current.splice(0);
          for (const c of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await publishProctorAnswer(
            targetUid,
            newSessionId,
            room.offerSdp,
            JSON.stringify(answer)
          );
        } catch {
          setHasRemoteStream(false);
          setRtcStatus('fallback');
        }
      }
    });
  };

  const handleStopWatch = async () => {
    const uid = watchingUid;
    const sid = sessionId;
    watchingSessionRef.current = null;
    cleanupViewer();
    setWatchingUid(null);
    setSessionId(null);
    if (uid && sid) {
      await endProctorWatch(uid, sid).catch(() => {});
    }
  };

  // Merge ONLY real VIP invites + active real presences (strictly excluding admin_preview & dummy accounts)
  const realInvites = invites.filter((i) => isRealCohortStudentUid(i.id));
  const realVipUids = new Set(realInvites.map((i) => i.id));
  const realStudents = students.filter((s) => isRealCohortStudentUid(s.uid, realVipUids));
  const realPresences = presences.filter((p) => isRealCohortStudentUid(p.uid, realVipUids));

  const presenceByUid = new Map(realPresences.map((p) => [p.uid, p]));
  const studentByUid = new Map(realStudents.map((s) => [s.uid, s]));

  const rows: Array<{
    uid: string;
    displayName: string;
    loginId: string;
    slotLabel: string;
    targetPost: string;
    presence?: StudentPresenceDoc;
    online: boolean;
  }> = [];

  const seenUids = new Set<string>();
  for (const inv of realInvites) {
    seenUids.add(inv.id);
    const prof = studentByUid.get(inv.id);
    const pres = presenceByUid.get(inv.id);
    const invMs = typeof inv.updatedAt === 'number' ? inv.updatedAt : (inv.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const profMs = prof ? (typeof prof.updatedAt === 'number' ? prof.updatedAt : (prof.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0) : 0;
    const preferProf = Boolean(prof && profMs > invMs);
    rows.push({
      uid: inv.id,
      displayName: (preferProf ? prof?.displayName : inv.displayName) || prof?.displayName || inv.displayName,
      loginId: inv.loginId,
      slotLabel: `VIP #${inv.slotNumber}`,
      targetPost: (preferProf ? prof?.targetPost : inv.targetPost) || prof?.targetPost || inv.targetPost,
      presence: pres,
      online: isPresenceOnline(pres, nowMs),
    });
  }

  for (const pres of realPresences) {
    if (!seenUids.has(pres.uid)) {
      seenUids.add(pres.uid);
      rows.push({
        uid: pres.uid,
        displayName: pres.displayName,
        loginId: pres.loginId,
        slotLabel: 'Active Session',
        targetPost: 'SSC CGL Cohort',
        presence: pres,
        online: isPresenceOnline(pres, nowMs),
      });
    }
  }

  const watchedPresence = watchingUid ? presenceByUid.get(watchingUid) : undefined;
  const watchedRow = watchingUid ? rows.find((r) => r.uid === watchingUid) : undefined;
  const onlineCount = rows.filter((r) => r.online).length;
  const inExamCount = rows.filter((r) => r.online && r.presence?.status === 'in_exam').length;
  const activeRelayUrl = relayFrame?.dataUrl ?? watchedPresence?.snapshotDataUrl;
  const isRelayLive = Boolean(relayFrame && nowMs - relayFrame.atMs <= 5000);

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Live Student Camera &amp; Exam Proctoring
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              See which VIP students are online or actively taking a mock test, monitor tab-switches, and connect to their live webcam feed.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono font-semibold text-slate-800 tabular-nums">
              Online Now: {onlineCount}
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 font-mono font-semibold text-blue-800 tabular-nums">
              In Exam: {inExamCount}
            </div>
          </div>
        </div>
      </div>

      {/* Live Video Viewer Stage (when Admin is watching a student) */}
      {watchingUid && watchedRow && (
        <section className="rounded-2xl border-2 border-slate-900 bg-slate-950 p-5 text-white space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <Video className="h-4 w-4" aria-hidden="true" />
                <span>
                  {hasRemoteStream
                    ? 'LIVE Camera Feed Active'
                    : isRelayLive
                      ? 'LIVE Camera Stream Active'
                      : rtcStatus === 'negotiating'
                        ? 'Connecting Live Video Stream...'
                        : watchedPresence?.cameraState === 'off'
                          ? 'Connecting to Student Auto-Camera...'
                          : 'Connecting Live Proctoring Stream...'}
                </span>
              </div>
              <h3 className="mt-1 font-display text-lg font-bold text-white">
                {watchedRow.displayName} ({watchedRow.loginId})
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleStartWatch(watchingUid)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reconnect Stream</span>
              </button>
              <button
                type="button"
                onClick={() => void handleStopWatch()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Student Grid</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-900 lg:col-span-7">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover transition-opacity duration-150 ${
                  hasRemoteStream ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
                }`}
              />
              {!hasRemoteStream && activeRelayUrl && (
                <img
                  src={activeRelayUrl}
                  alt={`${watchedRow.displayName} live camera stream`}
                  className="h-full w-full object-cover"
                />
              )}
              {!hasRemoteStream && !activeRelayUrl && (
                <div className="flex flex-col items-center gap-2 p-6 text-center text-slate-400">
                  <Camera className="h-8 w-8 text-slate-500" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-200">
                    {watchedPresence?.cameraState === 'denied'
                      ? 'Student denied camera permission in their browser.'
                      : watchedPresence?.cameraState === 'off'
                        ? 'Connecting to student webcam automatically...'
                        : 'Establishing live camera stream...'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Camera auto-starts on student login; live stream appears here automatically.
                  </p>
                </div>
              )}

              {!hasRemoteStream && activeRelayUrl && (
                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded bg-slate-950/85 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-300">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  {isRelayLive
                    ? 'LIVE STREAM'
                    : `Frame · ${formatLastSeen(relayFrame?.atMs ?? watchedPresence?.snapshotAtMs, nowMs)}`}
                </span>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs lg:col-span-5">
              <h4 className="font-display text-sm font-bold text-white">
                Real-Time Candidate Activity
              </h4>
              <div className="space-y-2.5 text-slate-300">
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Status</span>
                  <span className="font-semibold text-white">
                    {!watchedRow.online
                      ? 'Offline'
                      : watchedPresence?.status === 'in_exam'
                        ? 'In Active Mock Test'
                        : 'Online on Dashboard'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Current Test</span>
                  <span className="font-semibold text-white text-right max-w-[60%] truncate">
                    {watchedPresence?.currentTestTitle ?? 'Not in an exam'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Progress</span>
                  <span className="font-mono font-semibold text-white tabular-nums">
                    {watchedPresence?.status === 'in_exam' && watchedPresence.totalQuestions > 0
                      ? `Question ${watchedPresence.questionIndex + 1} / ${watchedPresence.totalQuestions}`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">Tab Switch Alerts</span>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      (watchedPresence?.tabSwitchCount ?? 0) > 0
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {watchedPresence?.tabSwitchCount ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Camera Hardware</span>
                  <span className="font-semibold text-white capitalize">
                    {watchedPresence?.cameraState ?? 'off'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Cohort Live Presence Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-8 text-center text-xs text-slate-500 md:col-span-2">
            No VIP student accounts created yet. Provision real VIP students in VIP Cohort to monitor them here.
          </div>
        ) : (
          rows.map((row) => {
            const pres = row.presence;
            const camReady = pres?.cameraState === 'ready' || pres?.cameraState === 'streaming';
            const isBeingWatched = watchingUid === row.uid;
            const tabCount = pres?.tabSwitchCount ?? 0;

            return (
              <article
                key={row.uid}
                className={`rounded-xl border bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4 ${
                  row.online ? 'border-slate-200 dark:border-slate-800' : 'border-slate-200 dark:border-slate-800 opacity-80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          !row.online
                            ? 'bg-slate-300'
                            : pres?.status === 'in_exam'
                              ? 'bg-blue-600'
                              : 'bg-emerald-500'
                        }`}
                        aria-hidden="true"
                      />
                      <h3 className="font-display text-base font-bold text-slate-900">
                        {row.displayName}
                      </h3>
                      <span className="text-xs font-mono text-slate-500">{row.slotLabel}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      ID: <span className="font-mono text-slate-700">{row.loginId}</span> · Target: {row.targetPost}
                    </p>
                  </div>

                  <span
                    className={`rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${
                      !row.online
                        ? 'bg-slate-100 text-slate-600'
                        : pres?.status === 'in_exam'
                          ? 'bg-blue-50 text-blue-800 border border-blue-200'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    {!row.online
                      ? 'Offline'
                      : pres?.status === 'in_exam'
                        ? 'In Exam'
                        : 'Online'}
                  </span>
                </div>

                {/* Live Activity & Snapshot Preview */}
                <div className="flex items-center gap-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-900 flex items-center justify-center">
                    {row.online && pres?.snapshotDataUrl ? (
                      <img
                        src={pres.snapshotDataUrl}
                        alt={`${row.displayName} camera preview`}
                        className="h-full w-full object-cover"
                      />
                    ) : camReady && row.online ? (
                      <Camera className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <CameraOff className="h-5 w-5 text-slate-500" aria-hidden="true" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1 text-xs">
                    <div className="truncate font-semibold text-slate-800">
                      {!row.online
                        ? `Last seen: ${formatLastSeen(pres?.lastSeenMs, nowMs)}`
                        : pres?.status === 'in_exam' && pres.currentTestTitle
                          ? `${pres.currentTestTitle} (Q${pres.questionIndex + 1}/${pres.totalQuestions})`
                          : 'Active on Student Dashboard'}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <MonitorCheck className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                        Cam: <strong className="capitalize">{pres?.cameraState ?? 'off'}</strong>
                      </span>
                      {tabCount > 0 ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          {tabCount} Tab Switch{tabCount > 1 ? 'es' : ''}
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium">0 Tab Switches</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 font-mono">
                    Heartbeat: {formatLastSeen(pres?.lastSeenMs, nowMs)}
                  </span>

                  {isBeingWatched ? (
                    <button
                      type="button"
                      onClick={() => void handleStopWatch()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                    >
                      <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Stop Watching</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!row.online}
                      onClick={() => void handleStartWatch(row.uid)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{camReady ? 'Watch Live Camera' : 'Connect Camera Feed'}</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
};
