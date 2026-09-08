import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { api } from '../api/client';
import type { AnalyzeResponse, Eye, QualityResult, ReportLang, SaveScreeningResponse, Source } from '../api/types';
import { useStoredString } from '../hooks/useLocalStorage';
import { useT, isLang } from '../i18n';
import { readFileAsDataUrl } from '../utils/format';
import { Stepper } from '../components/Stepper';
import { QualityCoach } from '../components/QualityCoach';
import { ImageViewer } from '../components/ImageViewer';
import { GradeCard } from '../components/GradeCard';
import { CameraCapture } from '../components/CameraCapture';
import { PatientSheet, type SheetData } from '../components/PatientSheet';
import { ErrorAlert, Loading, Toast, Alert } from '../components/ui';
import { IconArrowLeft, IconArrowRight, IconCamera, IconPrint, IconRefresh, IconShare, IconUpload } from '../components/Icons';
import { tierLabel } from '../components/TierPill';

type Step = 1 | 2 | 3 | 4;

interface PatientForm {
  patient_id: string;
  patient_name: string;
  age: string;
  sex: '' | 'female' | 'male' | 'other';
  diabetes_years: string;
  eye: Eye;
}

const EMPTY_FORM: PatientForm = { patient_id: '', patient_name: '', age: '', sex: '', diabetes_years: '', eye: 'right' };

interface Photo {
  file: File;
  url: string;
  dataUrl: string;
  source: Source;
}

export function Screen() {
  const { t, lang: uiLang } = useT();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<PatientForm>(EMPTY_FORM);
  const [site, setSite] = useStoredString('retinaedge.site');
  const [worker, setWorker] = useStoredString('retinaedge.worker');
  const [reportLangStored, setReportLangStored] = useStoredString('retinaedge.reportLang', uiLang);
  const reportLang: ReportLang = isLang(reportLangStored) ? reportLangStored : 'en';

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [quality, setQuality] = useState<QualityResult | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState<unknown>(null);

  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<unknown>(null);
  const [forced, setForced] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [saved, setSaved] = useState<SaveScreeningResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const photoUrlRef = useRef<string | null>(null);

  // Revoke object URLs when the photo changes or the page unmounts.
  useEffect(() => {
    photoUrlRef.current = photo?.url ?? null;
    return () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, [photo]);

  // Elapsed timer during analysis.
  useEffect(() => {
    if (!analysing) return;
    const start = performance.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.round(performance.now() - start)), 100);
    return () => window.clearInterval(id);
  }, [analysing]);

  const update = (patch: Partial<PatientForm>) => setForm((f) => ({ ...f, ...patch }));

  const acceptFile = useCallback(
    async (file: File, source: Source) => {
      if (!file.type.startsWith('image/')) {
        setFileError(t('photo.notImage'));
        return;
      }
      setFileError(null);
      setCameraOpen(false);
      setQuality(null);
      setQualityError(null);
      setResult(null);
      setForced(false);
      const url = URL.createObjectURL(file);
      let dataUrl = '';
      try {
        dataUrl = await readFileAsDataUrl(file);
      } catch {
        setFileError(t('photo.notImage'));
        URL.revokeObjectURL(url);
        return;
      }
      setPhoto({ file, url, dataUrl, source });
      setQualityLoading(true);
      try {
        const q = await api.quality(file, source);
        setQuality(q);
      } catch (e) {
        setQualityError(e);
      } finally {
        setQualityLoading(false);
      }
    },
    [t],
  );

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void acceptFile(f, 'upload');
    e.target.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void acceptFile(f, 'upload');
  };

  const runAnalyse = async (force: boolean) => {
    if (!photo) return;
    setForced(force);
    setResult(null);
    setAnalyseError(null);
    setStep(3);
    setAnalysing(true);
    try {
      const r = await api.analyze(photo.file, form.eye, photo.source, force);
      setResult(r);
    } catch (e) {
      setAnalyseError(e);
    } finally {
      setAnalysing(false);
    }
  };

  const save = async () => {
    if (!photo || !result) return;
    setSaving(true);
    setSaveError(null);
    const ageN = form.age.trim() === '' ? null : Number.parseInt(form.age, 10);
    const dyN = form.diabetes_years.trim() === '' ? null : Number.parseFloat(form.diabetes_years);
    try {
      const res = await api.saveScreening({
        image_data: photo.dataUrl,
        result,
        eye: form.eye,
        source: photo.source,
        site: site.trim() || null,
        worker: worker.trim() || null,
        patient_id: form.patient_id.trim() || null,
        patient_name: form.patient_name.trim() || null,
        age: ageN !== null && Number.isFinite(ageN) ? ageN : null,
        sex: form.sex || null,
        diabetes_years: dyN !== null && Number.isFinite(dyN) ? dyN : null,
        lang: reportLang,
      });
      setSaved(res);
      setStep(4);
      setToast(t('sheet.saved'));
      api
        .qr(res.id)
        .then((q) => setQrImage(q.image))
        .catch(() => undefined);
    } catch (e) {
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStep(1);
    setForm(EMPTY_FORM);
    setPhoto(null);
    setQuality(null);
    setQualityError(null);
    setResult(null);
    setAnalyseError(null);
    setForced(false);
    setSaved(null);
    setSaveError(null);
    setQrImage(null);
    setCameraOpen(false);
    setFileError(null);
  };

  const share = async () => {
    if (!saved || !result) return;
    const url = `${window.location.origin}/records/${saved.id}`;
    const text = t('sheet.shareText', { id: saved.id, grade: result.grade?.grade ?? t('grade.notAvailable'), tier: tierLabel(t, result.tier.code) });
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('app.name'), text, url });
        return;
      } catch {
        /* user cancelled or share failed; fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast(t('sheet.copied'));
    } catch {
      window.prompt(t('sheet.copyLink'), url);
    }
  };

  const sheetData = useMemo<SheetData | null>(() => {
    if (!saved || !result || !photo) return null;
    const ageN = form.age.trim() === '' ? null : Number.parseInt(form.age, 10);
    const dyN = form.diabetes_years.trim() === '' ? null : Number.parseFloat(form.diabetes_years);
    return {
      id: saved.id,
      date: saved.qr.summary.date || new Date().toISOString(),
      site: site.trim() || null,
      worker: worker.trim() || null,
      patientId: form.patient_id.trim() || null,
      patientName: form.patient_name.trim() || null,
      age: ageN !== null && Number.isFinite(ageN) ? ageN : null,
      sex: form.sex || null,
      diabetesYears: dyN !== null && Number.isFinite(dyN) ? dyN : null,
      eye: form.eye,
      lang: reportLang,
      gradeIndex: result.grade?.grade_index ?? null,
      gradeName: result.grade?.grade ?? null,
      confidence: result.grade?.confidence ?? null,
      tier: result.tier,
      qualityState: result.quality.state,
      forced: !!result.quality.forced,
      lesionCounts: result.lesions?.counts ?? null,
      lesionColors: result.lesions?.colors ?? null,
      imageUrl: photo.dataUrl,
      overlayUrl: result.lesions?.overlay ?? null,
      cropBox: result.crop_box,
      qrImage,
      qrLoading: !qrImage,
    };
  }, [saved, result, photo, form, site, worker, reportLang, qrImage]);

  return (
    <div className="page">
      <div className="page__header no-print">
        <div>
          <h1>{t('nav.screen')}</h1>
        </div>
      </div>
      <Stepper current={step} />

      {step === 1 ? (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <div>
            <h2>{t('patient.title')}</h2>
            <p className="small muted">{t('patient.hint')}</p>
          </div>
          <div className="form-grid">
            <div className="field">
              <label className="field__label" htmlFor="f-pid">
                {t('patient.id')}
              </label>
              <input id="f-pid" className="input mono" value={form.patient_id} onChange={(e) => update({ patient_id: e.target.value })} autoComplete="off" />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-name">
                {t('patient.name')}
              </label>
              <input id="f-name" className="input" value={form.patient_name} onChange={(e) => update({ patient_name: e.target.value })} autoComplete="off" />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-age">
                {t('patient.age')}
              </label>
              <input id="f-age" className="input num" type="number" inputMode="numeric" min={0} max={120} value={form.age} onChange={(e) => update({ age: e.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-sex">
                {t('patient.sex')}
              </label>
              <select id="f-sex" className="select" value={form.sex} onChange={(e) => update({ sex: e.target.value as PatientForm['sex'] })}>
                <option value="">{t('sex.unspecified')}</option>
                <option value="female">{t('sex.female')}</option>
                <option value="male">{t('sex.male')}</option>
                <option value="other">{t('sex.other')}</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-dy">
                {t('patient.diabetesYears')}
              </label>
              <input id="f-dy" className="input num" type="number" inputMode="decimal" min={0} max={80} step="0.5" value={form.diabetes_years} onChange={(e) => update({ diabetes_years: e.target.value })} />
            </div>
            <div className="field">
              <span className="field__label" id="f-eye-label">
                {t('patient.eye')}
              </span>
              <div className="segmented segmented--block" role="radiogroup" aria-labelledby="f-eye-label">
                {(['right', 'left'] as Eye[]).map((eye) => (
                  <button key={eye} type="button" role="radio" aria-checked={form.eye === eye} className="segmented__btn" onClick={() => update({ eye })}>
                    {t(`eye.${eye}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-site">
                {t('patient.site')}
              </label>
              <input id="f-site" className="input" value={site} onChange={(e) => setSite(e.target.value)} autoComplete="organization" />
              <span className="field__hint">{t('patient.remembered')}</span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-worker">
                {t('patient.worker')}
              </label>
              <input id="f-worker" className="input" value={worker} onChange={(e) => setWorker(e.target.value)} autoComplete="name" />
              <span className="field__hint">{t('patient.remembered')}</span>
            </div>
            <div className="field">
              <span className="field__label" id="f-lang-label">
                {t('patient.reportLang')}
              </span>
              <div className="segmented segmented--block" role="radiogroup" aria-labelledby="f-lang-label">
                {(['en', 'hi'] as ReportLang[]).map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={reportLang === l} className="segmented__btn" onClick={() => setReportLangStored(l)}>
                    {t(`lang.${l}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="row row--end">
            <button type="submit" className="btn btn--primary btn--lg">
              {t('patient.continue')}
              <IconArrowRight />
            </button>
          </div>
        </form>
      ) : null}

      {step === 2 ? (
        <div className="stack">
          <input ref={fileInput} type="file" accept="image/*" className="visually-hidden" onChange={onInputChange} aria-label={t('photo.choose')} tabIndex={-1} />

          {cameraOpen ? (
            <div className="card">
              <CameraCapture onCapture={(f) => void acceptFile(f, 'camera')} onClose={() => setCameraOpen(false)} />
            </div>
          ) : !photo ? (
            <div
              className={`dropzone${dragOver ? ' dropzone--over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <IconUpload />
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{t('photo.drop')}</div>
              <div className="xs">{t('photo.or')}</div>
              <div className="dropzone__actions">
                <button type="button" className="btn btn--primary" onClick={() => fileInput.current?.click()}>
                  <IconUpload />
                  {t('photo.choose')}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setCameraOpen(true)}>
                  <IconCamera />
                  {t('photo.useCamera')}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid-2">
              <div className="card stack">
                <h2>{t('photo.title')}</h2>
                <ImageViewer src={photo.url} alt={t('photo.preview')} fieldCircle={quality?.field_circle ?? null} compact />
                <div className="row">
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => fileInput.current?.click()}>
                    <IconUpload />
                    {t('photo.change')}
                  </button>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => setCameraOpen(true)}>
                    <IconCamera />
                    {t('photo.useCamera')}
                  </button>
                </div>
              </div>
              <div className="stack">
                {qualityLoading ? (
                  <div className="card">
                    <Loading label={t('photo.checking')} />
                  </div>
                ) : qualityError ? (
                  <ErrorAlert error={qualityError} onRetry={() => void acceptFile(photo.file, photo.source)} />
                ) : quality ? (
                  <>
                    <QualityCoach quality={quality} />
                    <div className="stack stack--sm">
                      {quality.gradable ? (
                        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => void runAnalyse(false)}>
                          {t('photo.analyse')}
                          <IconArrowRight />
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => fileInput.current?.click()}>
                            <IconRefresh />
                            {t('photo.retake')}
                          </button>
                          <div style={{ textAlign: 'center' }}>
                            <button type="button" className="link-btn" onClick={() => void runAnalyse(true)}>
                              {t('photo.analyseAnyway')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {fileError ? <Alert kind="error">{fileError}</Alert> : null}

          <div className="row">
            <button type="button" className="btn btn--ghost" onClick={() => setStep(1)}>
              <IconArrowLeft />
              {t('app.back')}
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && photo ? (
        <div className="stack">
          {analysing ? (
            <div className="card">
              <Loading block label={`${t('result.analysing')} · ${t('result.elapsed')} ${(elapsed / 1000).toFixed(1)} s`} />
            </div>
          ) : analyseError ? (
            <div className="stack">
              <ErrorAlert error={analyseError} onRetry={() => void runAnalyse(forced)} />
              <div className="row">
                <button type="button" className="btn btn--secondary" onClick={() => setStep(2)}>
                  <IconArrowLeft />
                  {t('result.retake')}
                </button>
              </div>
            </div>
          ) : result ? (
            <div className="grid-2">
              <div className="card">
                <ImageViewer
                  src={photo.url}
                  lesionOverlay={result.lesions?.overlay ?? null}
                  camOverlay={result.cam?.overlay ?? null}
                  cropBox={result.crop_box}
                  fieldCircle={result.quality.field_circle}
                  lesions={result.lesions ?? null}
                />
              </div>
              <div className="stack">
                <GradeCard
                  grade={result.grade}
                  tier={result.tier}
                  why={result.why}
                  timings={result.timings_ms}
                  disclaimer={result.disclaimer}
                  quality={result.quality}
                  actions={
                    <>
                      <button type="button" className="btn btn--primary btn--lg" onClick={() => void save()} disabled={saving}>
                        {saving ? t('result.saving') : result.grade ? t('result.save') : t('result.saveUngradable')}
                      </button>
                      <button type="button" className="btn btn--secondary" onClick={() => setStep(2)} disabled={saving}>
                        <IconArrowLeft />
                        {t('result.retake')}
                      </button>
                    </>
                  }
                />
                {saveError ? <ErrorAlert error={saveError} onRetry={() => void save()} /> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 4 && sheetData ? (
        <div className="stack">
          <div className="sheet-actions no-print">
            <button type="button" className="btn btn--primary" onClick={() => window.print()}>
              <IconPrint />
              {t('sheet.print')}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void share()}>
              <IconShare />
              {typeof navigator.share === 'function' ? t('sheet.share') : t('sheet.copyLink')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={reset}>
              <IconRefresh />
              {t('sheet.newScreening')}
            </button>
          </div>
          <PatientSheet data={sheetData} />
        </div>
      ) : null}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
