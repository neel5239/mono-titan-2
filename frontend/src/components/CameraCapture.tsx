import { useCallback, useEffect, useRef, useState } from 'react';
import type { QualityResult } from '../api/types';
import { useT } from '../i18n';
import { Alert } from './ui';
import { IconCamera, IconClose } from './Icons';

type CamState = 'starting' | 'ready' | 'insecure' | 'unsupported' | 'denied';

const LIVE_INTERVAL_MS = 800;
const LIVE_WIDTH = 640;

/**
 * Camera capture with a live quality coach: every frame is sent to /api/quality while the preview runs,
 * the reticle and a status strip show green / yellow / red with the reason, and whether a retinal lens is detected.
 */
export function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const [state, setState] = useState<CamState>('starting');
  const [live, setLive] = useState<QualityResult | null>(null);
  const [liveError, setLiveError] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!window.isSecureContext) {
      setState('insecure');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          void v.play().catch(() => undefined);
        }
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('denied');
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  // Live coaching loop: downscale the current frame and ask the quality gate.
  useEffect(() => {
    if (state !== 'ready') return;
    const canvas = document.createElement('canvas');
    const tick = async () => {
      const v = videoRef.current;
      if (!v || v.videoWidth === 0 || busyRef.current || !streamRef.current) return;
      busyRef.current = true;
      try {
        const scale = Math.min(1, LIVE_WIDTH / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
        if (!blob) return;
        const fd = new FormData();
        fd.append('file', blob, 'live.jpg');
        fd.append('source', 'camera');
        const r = await fetch('/api/quality', { method: 'POST', body: fd });
        if (!r.ok) throw new Error(String(r.status));
        const q = (await r.json()) as QualityResult;
        setLive(q);
        setLiveError(false);
      } catch {
        setLiveError(true);
      } finally {
        busyRef.current = false;
      }
    };
    const id = window.setInterval(() => void tick(), LIVE_INTERVAL_MS);
    void tick();
    return () => window.clearInterval(id);
  }, [state]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        stop();
        onCapture(file);
      },
      'image/jpeg',
      0.94,
    );
  };

  if (state === 'insecure' || state === 'unsupported' || state === 'denied') {
    const key = state === 'insecure' ? 'photo.cameraInsecure' : state === 'unsupported' ? 'photo.cameraUnsupported' : 'photo.cameraDenied';
    return (
      <div className="stack">
        <Alert kind="warn">{t(key)}</Alert>
        <div>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            <IconClose />
            {t('photo.cancelCamera')}
          </button>
        </div>
      </div>
    );
  }

  const liveState = live?.state ?? null;
  const canCapture = state === 'ready' && (live ? live.state !== 'red' : true);
  const liveText = liveError
    ? t('photo.live.checking')
    : !live
      ? t('photo.live.starting')
      : live.state === 'green'
        ? t('photo.live.ready')
        : live.message;

  return (
    <div>
      <div className="camera">
        <video ref={videoRef} playsInline muted autoPlay aria-label={t('photo.useCamera')} />
        <svg
          className={`camera__reticle${liveState ? ` camera__reticle--${liveState}` : ''}`}
          viewBox="0 0 400 300"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <mask id="reticle-mask">
              <rect width="400" height="300" fill="#fff" />
              <circle cx="200" cy="150" r="120" fill="#000" />
            </mask>
          </defs>
          <rect width="400" height="300" fill="rgba(0,0,0,0.45)" mask="url(#reticle-mask)" />
          <circle cx="200" cy="150" r="120" fill="none" stroke="#5CC3C9" strokeWidth="2" strokeDasharray="10 6" />
          <circle cx="200" cy="150" r="4" fill="#F07A3F" />
          <line x1="200" y1="20" x2="200" y2="40" stroke="#5CC3C9" strokeWidth="2" />
          <line x1="200" y1="260" x2="200" y2="280" stroke="#5CC3C9" strokeWidth="2" />
          <line x1="70" y1="150" x2="90" y2="150" stroke="#5CC3C9" strokeWidth="2" />
          <line x1="310" y1="150" x2="330" y2="150" stroke="#5CC3C9" strokeWidth="2" />
        </svg>
        <div className="camera__live" role="status" aria-live="polite">
          <span className={`camera__live-dot${liveState ? ` camera__live-dot--${liveState}` : ''}`} aria-hidden="true" />
          <span className="camera__live-text">
            {liveState ? <b>{t(`quality.${liveState}`)}. </b> : null}
            {liveText}
          </span>
          {live ? (
            <span className="camera__live-lens" style={{ color: live.lens_detected ? 'var(--good)' : 'var(--warn)' }}>
              {live.lens_detected ? t('quality.lensOk') : t('quality.noLens').split('.')[0]}
            </span>
          ) : null}
        </div>
      </div>
      {live && live.lens_detected === false && !live.reasons.includes('not_fundus') ? (
        <div className="lens-warning" style={{ marginTop: 8 }}>
          <span className="lens-warning__dot" aria-hidden="true" />
          <span>{t('quality.noLens')}</span>
        </div>
      ) : null}
      <p className="xs muted" style={{ textAlign: 'center', marginTop: 8 }}>
        {t('photo.live.hint')}
      </p>
      <div className="camera__controls">
        <button type="button" className="btn btn--primary btn--lg" onClick={capture} disabled={!canCapture}>
          <IconCamera />
          {t('photo.capture')}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          <IconClose />
          {t('photo.cancelCamera')}
        </button>
      </div>
    </div>
  );
}
