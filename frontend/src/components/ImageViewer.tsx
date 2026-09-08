import { useMemo, useState, type CSSProperties } from 'react';
import type { CropBox, FieldCircle, LesionName } from '../api/types';
import { useT } from '../i18n';
import { LESION_ORDER } from '../utils/format';

export interface LesionSummary {
  counts: Record<string, number>;
  area_pct?: Record<string, number>;
  near_macula?: Record<string, boolean>;
  colors?: Record<string, string>;
}

export interface ImageViewerProps {
  src: string;
  alt?: string;
  lesionOverlay?: string | null;
  camOverlay?: string | null;
  cropBox?: CropBox | null;
  fieldCircle?: FieldCircle | null;
  lesions?: LesionSummary | null;
  /** Hide toggle row and legend (used inside the print sheet). */
  compact?: boolean;
  className?: string;
}

/** Position an overlay rendered on the cropped image over the original image using crop_box. */
export function overlayStyle(cropBox: CropBox | null | undefined, natural: { w: number; h: number } | null): CSSProperties {
  if (!cropBox || !natural || natural.w === 0 || natural.h === 0) {
    return { left: 0, top: 0, width: '100%', height: '100%' };
  }
  const [x0, y0, x1, y1] = cropBox;
  return {
    left: `${(x0 / natural.w) * 100}%`,
    top: `${(y0 / natural.h) * 100}%`,
    width: `${((x1 - x0) / natural.w) * 100}%`,
    height: `${((y1 - y0) / natural.h) * 100}%`,
  };
}

export function ImageViewer({ src, alt, lesionOverlay, camOverlay, cropBox, fieldCircle, lesions, compact = false, className }: ImageViewerProps) {
  const { t } = useT();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [showLesions, setShowLesions] = useState(true);
  const [showCam, setShowCam] = useState(false);
  const [showField, setShowField] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const ovStyle = useMemo(() => overlayStyle(cropBox, natural), [cropBox, natural]);

  const lesionNames = useMemo<LesionName[]>(() => {
    if (!lesions) return [];
    const extra = Object.keys(lesions.counts).filter((k) => !(LESION_ORDER as string[]).includes(k)) as LesionName[];
    return [...LESION_ORDER.filter((k) => k in lesions.counts), ...extra];
  }, [lesions]);

  const toggleHidden = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const circle = fieldCircle && natural ? { cx: fieldCircle.x * natural.w, cy: fieldCircle.y * natural.h, r: fieldCircle.r * Math.min(natural.w, natural.h) } : null;

  return (
    <div className={`viewer${className ? ` ${className}` : ''}`}>
      <div className="viewer__stage">
        <img
          className="viewer__img"
          src={src}
          alt={alt ?? t('viewer.imageAlt')}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {camOverlay && showCam ? <img className="viewer__overlay" src={camOverlay} alt="" style={ovStyle} /> : null}
        {lesionOverlay && showLesions ? <img className="viewer__overlay" src={lesionOverlay} alt="" style={ovStyle} /> : null}
        {circle && showField && natural ? (
          <svg className="viewer__svg" viewBox={`0 0 ${natural.w} ${natural.h}`} aria-hidden="true">
            <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill="none" stroke="#5CC3C9" strokeWidth={Math.max(2, natural.w / 300)} strokeDasharray={`${natural.w / 60} ${natural.w / 90}`} />
            <circle cx={circle.cx} cy={circle.cy} r={Math.max(3, natural.w / 150)} fill="#5CC3C9" />
          </svg>
        ) : null}
      </div>

      {!compact ? (
        <>
          <div className="viewer__toggles" role="group" aria-label={t('viewer.overlays')}>
            <button type="button" className="toggle" aria-pressed={showLesions} disabled={!lesionOverlay} onClick={() => setShowLesions((v) => !v)}>
              {t('viewer.lesions')}
            </button>
            <button type="button" className="toggle" aria-pressed={showCam} disabled={!camOverlay} onClick={() => setShowCam((v) => !v)}>
              {t('viewer.heatmap')}
            </button>
            <button type="button" className="toggle" aria-pressed={showField} disabled={!fieldCircle} onClick={() => setShowField((v) => !v)}>
              {t('viewer.fieldCircle')}
            </button>
          </div>

          {lesions && lesionNames.length > 0 ? (
            <div>
              <div className="xs muted" style={{ fontWeight: 600, marginBottom: 6 }}>
                {t('viewer.legend')}
              </div>
              <div className="legend">
                {lesionNames.map((name) => {
                  const count = lesions.counts[name] ?? 0;
                  const area = lesions.area_pct?.[name];
                  const near = lesions.near_macula?.[name];
                  const color = lesions.colors?.[name] ?? 'var(--accent)';
                  return (
                    <button key={name} type="button" className="legend__chip" aria-pressed={!hidden.has(name)} onClick={() => toggleHidden(name)}>
                      <span className="legend__swatch" style={{ background: color }} aria-hidden="true" />
                      <span className="legend__name">{t(`lesion.${name}`)}</span>
                      {near ? <span className="legend__macula">{t('viewer.nearMacula')}</span> : null}
                      <span className="legend__meta">
                        {count}
                        {area !== undefined ? ` · ${area.toFixed(2)}%` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : lesions === null || lesions === undefined ? (
            <p className="xs muted">{t('viewer.noLesionModel')}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
