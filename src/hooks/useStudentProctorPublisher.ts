import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addProctorCandidate,
  publishProctorOffer,
  subscribeProctorCandidates,
  subscribeProctorRoom,
  upsertStudentPresence,
} from '../lib/firestoreService';
import { isFirestoreQuotaExceeded } from '../utils/firestoreQuota';
import { isRealCohortStudentUid } from '../utils/sessionAndOverrides';
import type { CameraState, PresenceStatus, ProctorRoomDoc, StudentProfile } from '../types/exam';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

const CAM_CONSENT_PREFIX = 'getcgl_cam_consent_v1_';

export function getCameraConsentGranted(uid?: string | null): boolean {
  if (!uid) return false;
  try {
    return localStorage.getItem(`${CAM_CONSENT_PREFIX}${uid}`) === 'granted';
  } catch {
    return false;
  }
}

export function setCameraConsentGranted(uid: string, granted: boolean): void {
  try {
    if (granted) {
      localStorage.setItem(`${CAM_CONSENT_PREFIX}${uid}`, 'granted');
    } else {
      localStorage.removeItem(`${CAM_CONSENT_PREFIX}${uid}`);
    }
  } catch {
    // Ignore storage quota issues
  }
}

interface UseStudentProctorPublisherParams {
  student: StudentProfile | null;
  status: PresenceStatus;
  currentTestId?: string;
  currentTestTitle?: string;
  questionIndex: number;
  totalQuestions: number;
}

export function useStudentProctorPublisher(params: UseStudentProctorPublisherParams) {
  const {
    student,
    status,
    currentTestId,
    currentTestTitle,
    questionIndex,
    totalQuestions,
  } = params;

  const [cameraState, setCameraState] = useState<CameraState>('off');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isWatchedByAdmin, setIsWatchedByAdmin] = useState(false);
  const [watchRequestedWhileOff, setWatchRequestedWhileOff] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const requestingCamRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const rtcConnectedRef = useRef(false);
  const activeSessionRef = useRef<string | null>(null);
  const candUnsubRef = useRef<(() => void) | null>(null);
  const appliedAnswerForSessionRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const latestRoomRef = useRef<ProctorRoomDoc | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSnapshotRef = useRef<{ dataUrl?: string; atMs?: number }>({});
  const relayInFlightRef = useRef(false);

  const cameraStateRef = useRef<CameraState>('off');
  cameraStateRef.current = cameraState;

  const metaRef = useRef({
    student,
    status,
    currentTestId,
    currentTestTitle,
    questionIndex,
    totalQuestions,
    tabSwitchCount,
  });
  metaRef.current = {
    student,
    status,
    currentTestId,
    currentTestTitle,
    questionIndex,
    totalQuestions,
    tabSwitchCount,
  };

  const detachHiddenVideo = useCallback(() => {
    const v = hiddenVideoRef.current;
    if (v) {
      v.srcObject = null;
      if (v.parentNode) {
        v.parentNode.removeChild(v);
      }
      hiddenVideoRef.current = null;
    }
  }, []);

  const ensureHiddenVideoAttached = useCallback((stream: MediaStream): HTMLVideoElement => {
    let video = hiddenVideoRef.current;
    if (!video) {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.tabIndex = -1;
      video.setAttribute('aria-hidden', 'true');
      video.style.position = 'fixed';
      video.style.width = '2px';
      video.style.height = '2px';
      video.style.opacity = '0.001';
      video.style.pointerEvents = 'none';
      video.style.left = '-9999px';
      video.style.top = '-9999px';
      document.body?.appendChild(video);
      hiddenVideoRef.current = video;
    } else if (!video.parentNode && document.body) {
      document.body.appendChild(video);
    }
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
    return video;
  }, []);

  // Capture compressed JPEG frame from DOM-attached <video> so Chromium never freezes decoding
  const captureFrameDataUrl = useCallback(
    (quality: number = 0.55): string | undefined => {
      const stream = streamRef.current;
      if (!stream || stream.getVideoTracks().length === 0) return undefined;
      try {
        const video = ensureHiddenVideoAttached(stream);
        if (video.paused && stream.active) {
          void video.play().catch(() => {});
        }
        if (video.readyState < 2 || video.videoWidth === 0) return undefined;

        if (!hiddenCanvasRef.current) {
          const c = document.createElement('canvas');
          c.width = 360;
          c.height = 202;
          hiddenCanvasRef.current = c;
        }
        const canvas = hiddenCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= 78_000) {
          lastSnapshotRef.current = { dataUrl, atMs: Date.now() };
          return dataUrl;
        }
        const compact = canvas.toDataURL('image/jpeg', 0.4);
        if (compact.length <= 78_000) {
          lastSnapshotRef.current = { dataUrl: compact, atMs: Date.now() };
          return compact;
        }
      } catch {
        // Ignore transient capture errors
      }
      return undefined;
    },
    [ensureHiddenVideoAttached]
  );

  const pushPresence = useCallback(
    async (override?: Partial<{ status: PresenceStatus; cameraState: CameraState; includeSnapshot: boolean }>) => {
      const m = metaRef.current;
      if (!m.student || !isRealCohortStudentUid(m.student.uid) || isFirestoreQuotaExceeded()) return;
      let snapUrl = lastSnapshotRef.current.dataUrl;
      let snapAt = lastSnapshotRef.current.atMs;
      const camSt = override?.cameraState ?? cameraStateRef.current;
      if (override?.includeSnapshot && (camSt === 'ready' || camSt === 'streaming')) {
        const fresh = captureFrameDataUrl(0.45);
        if (fresh) {
          snapUrl = fresh;
          snapAt = Date.now();
        }
      }
      await upsertStudentPresence({
        uid: m.student.uid,
        displayName: m.student.displayName,
        loginId: m.student.loginId,
        status: override?.status ?? m.status,
        cameraState: camSt,
        currentTestId: m.currentTestId,
        currentTestTitle: m.currentTestTitle,
        questionIndex: m.questionIndex,
        totalQuestions: m.totalQuestions,
        tabSwitchCount: m.tabSwitchCount,
        lastSeenMs: Date.now(),
        ...(snapUrl ? { snapshotDataUrl: snapUrl, snapshotAtMs: snapAt } : {}),
      }).catch(() => {});
    },
    [captureFrameDataUrl]
  );

  const cleanupPeer = useCallback(() => {
    if (candUnsubRef.current) {
      candUnsubRef.current();
      candUnsubRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    rtcConnectedRef.current = false;
    activeSessionRef.current = null;
    appliedAnswerForSessionRef.current = null;
    pendingCandidatesRef.current = [];
    setIsWatchedByAdmin(false);
  }, []);

  const startPeerOfferForRoom = useCallback(
    async (uid: string, sessionId: string) => {
      const stream = streamRef.current;
      if (!stream || typeof RTCPeerConnection === 'undefined') return;

      cleanupPeer();
      activeSessionRef.current = sessionId;
      setIsWatchedByAdmin(true);
      setCameraState('streaming');

      try {
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.onicecandidate = (evt) => {
          if (evt.candidate) {
            void addProctorCandidate(uid, sessionId, 'student', JSON.stringify(evt.candidate)).catch(
              () => {}
            );
          }
        };

        const syncRtcState = () => {
          const state = pc.connectionState;
          const ice = pc.iceConnectionState;
          rtcConnectedRef.current =
            state === 'connected' || ice === 'connected' || ice === 'completed';
          if (state === 'failed' || state === 'closed') {
            rtcConnectedRef.current = false;
            if (streamRef.current) setCameraState('ready');
          }
        };

        pc.onconnectionstatechange = syncRtcState;
        pc.oniceconnectionstatechange = syncRtcState;

        candUnsubRef.current = subscribeProctorCandidates(uid, sessionId, 'admin', (cand) => {
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
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await publishProctorOffer(uid, sessionId, JSON.stringify(offer));
        await pushPresence({ cameraState: 'streaming', includeSnapshot: true });
      } catch {
        cleanupPeer();
        if (streamRef.current?.active) {
          setCameraState('ready');
        }
      }
    },
    [cleanupPeer, pushPresence]
  );

  const enableCamera = useCallback(async (): Promise<boolean> => {
    const activeStudent = metaRef.current.student;
    if (!activeStudent) return false;
    if (streamRef.current && streamRef.current.active) {
      return true;
    }
    if (requestingCamRef.current) {
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('denied');
      setCameraError('Camera API is not supported in this browser.');
      return false;
    }

    requestingCamRef.current = true;
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480 },
          height: { ideal: 360 },
          frameRate: { ideal: 15, max: 24 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      ensureHiddenVideoAttached(stream);
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (streamRef.current === stream) {
            streamRef.current = null;
            detachHiddenVideo();
            setLocalStream(null);
            setCameraState('off');
            void pushPresence({ cameraState: 'off' });
          }
        };
      });

      setLocalStream(stream);
      setCameraState('ready');
      setCameraConsentGranted(activeStudent.uid, true);
      setWatchRequestedWhileOff(false);
      await pushPresence({ cameraState: 'ready', includeSnapshot: true });

      const room = latestRoomRef.current;
      if (room && (room.status === 'requested' || room.status === 'connected') && room.sessionId) {
        void startPeerOfferForRoom(activeStudent.uid, room.sessionId);
      }

      window.setTimeout(() => {
        if (streamRef.current?.active) {
          void pushPresence({ includeSnapshot: true });
        }
      }, 800);
      return true;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Camera permission was blocked or unavailable.';
      setCameraState('denied');
      setCameraError(msg);
      setCameraConsentGranted(activeStudent.uid, false);
      await pushPresence({ cameraState: 'denied' });
      return false;
    } finally {
      requestingCamRef.current = false;
    }
  }, [detachHiddenVideo, ensureHiddenVideoAttached, pushPresence, startPeerOfferForRoom]);

  const disableCamera = useCallback(() => {
    cleanupPeer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    detachHiddenVideo();
    lastSnapshotRef.current = {};
    setLocalStream(null);
    setCameraState('off');
    setCameraError(null);
    void pushPresence({ cameraState: 'off' });
  }, [cleanupPeer, detachHiddenVideo, pushPresence]);

  // Reset tab switch count when entering a new exam test
  useEffect(() => {
    setTabSwitchCount(0);
  }, [currentTestId]);

  // Track tab/window switches while in an active exam
  useEffect(() => {
    if (!student || status !== 'in_exam') return;
    const onVisChange = () => {
      if (document.hidden) {
        setTabSwitchCount((c) => c + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [student, status]);

  // Immediate presence update when status/question/tab switches change (throttled across renders via stable primitives)
  useEffect(() => {
    if (!student?.uid || !isRealCohortStudentUid(student.uid)) return;
    void pushPresence({
      includeSnapshot: isWatchedByAdmin || status === 'in_exam',
    });
  }, [
    student?.uid,
    student?.displayName,
    student?.loginId,
    status,
    currentTestId,
    currentTestTitle,
    questionIndex,
    totalQuestions,
    tabSwitchCount,
    isWatchedByAdmin,
    pushPresence,
  ]);

  // Periodic Firestore presence heartbeat (45s when camera active, 180s idle) + offline cleanup
  useEffect(() => {
    if (!student?.uid || !isRealCohortStudentUid(student.uid)) return;
    const isCamActive = cameraState === 'ready' || cameraState === 'streaming';
    const intervalMs = isCamActive ? 45_000 : 180_000;
    const timer = window.setInterval(() => {
      if (isFirestoreQuotaExceeded()) return;
      if (document.visibilityState !== 'visible' && !isCamActive) return;
      void pushPresence({
        includeSnapshot:
          !rtcConnectedRef.current &&
          (isWatchedByAdmin || status === 'in_exam') &&
          (cameraStateRef.current === 'streaming' || cameraStateRef.current === 'ready'),
      });
    }, intervalMs);

    const onPageHide = () => {
      void pushPresence({ status: 'offline', cameraState: 'off' });
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [student?.uid, cameraState, pushPresence]);

  // Subscribe to proctorRooms/{uid} for incoming Admin live watch requests & SDP answers
  useEffect(() => {
    if (!student || !isRealCohortStudentUid(student.uid)) return;
    const unsub = subscribeProctorRoom(student.uid, (room) => {
      latestRoomRef.current = room;
      if (!room) return;

      if (room.status === 'ended' || room.status === 'idle') {
        cleanupPeer();
        setWatchRequestedWhileOff(false);
        if (streamRef.current) setCameraState('ready');
        return;
      }

      if (room.status === 'requested') {
        setIsWatchedByAdmin(true);
        if (streamRef.current && streamRef.current.active) {
          if (activeSessionRef.current !== room.sessionId) {
            void startPeerOfferForRoom(student.uid, room.sessionId);
          }
        } else {
          setWatchRequestedWhileOff(true);
          if (getCameraConsentGranted(student.uid)) {
            void enableCamera();
          }
        }
        return;
      }

      if (
        room.status === 'connected' &&
        room.answerSdp &&
        pcRef.current &&
        activeSessionRef.current === room.sessionId &&
        appliedAnswerForSessionRef.current !== room.sessionId
      ) {
        appliedAnswerForSessionRef.current = room.sessionId;
        try {
          const answer = JSON.parse(room.answerSdp) as RTCSessionDescriptionInit;
          const pc = pcRef.current;
          void pc
            .setRemoteDescription(new RTCSessionDescription(answer))
            .then(async () => {
              const queued = pendingCandidatesRef.current.splice(0);
              for (const c of queued) {
                await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              }
            })
            .catch(() => {});
        } catch {
          // Ignore malformed SDP
        }
      }
    });

    return () => {
      unsub();
    };
  }, [student?.uid, cleanupPeer, enableCamera, startPeerOfferForRoom]);

  // Only auto-start camera on login if user already granted one-time consent AND browser permission stays 'granted'
  useEffect(() => {
    if (!student) {
      cleanupPeer();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      detachHiddenVideo();
      setLocalStream(null);
      setCameraState('off');
      setWatchRequestedWhileOff(false);
      return;
    }

    let cancelled = false;
    let permStatus: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (!permStatus) return;
      if (permStatus.state === 'granted') {
        if (getCameraConsentGranted(student.uid) && !streamRef.current?.active) {
          void enableCamera();
        }
      } else {
        setCameraConsentGranted(student.uid, false);
        if (permStatus.state === 'denied') {
          setCameraState('denied');
        } else {
          setCameraState('off');
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          detachHiddenVideo();
          setLocalStream(null);
        }
      }
    };

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((ps) => {
          if (cancelled) return;
          permStatus = ps;
          ps.addEventListener('change', handlePermChange);
          if (ps.state === 'granted' && getCameraConsentGranted(student.uid)) {
            void enableCamera();
          } else if (ps.state === 'denied') {
            setCameraConsentGranted(student.uid, false);
            setCameraState('denied');
          }
        })
        .catch(() => {
          // Wait for explicit user consent on test start
        });
    }

    return () => {
      cancelled = true;
      if (permStatus) {
        permStatus.removeEventListener('change', handlePermChange);
      }
      detachHiddenVideo();
    };
  }, [student?.uid, cleanupPeer, detachHiddenVideo, enableCamera]);

  return {
    cameraState,
    cameraError,
    localStream,
    isWatchedByAdmin,
    watchRequestedWhileOff,
    tabSwitchCount,
    enableCamera,
    disableCamera,
  };
}
