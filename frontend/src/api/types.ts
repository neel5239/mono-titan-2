export type QualityState = 'green' | 'yellow' | 'red';

export interface QualityMetrics {
  centering: number;
  sharpness: number;
  glare: number;
  exposure: number;
  field: number;
  contrast: number;
}

export interface FieldCircle {
  x: number;
  y: number;
  r: number;
}

export interface QualityResult {
  state: QualityState;
  gradable: boolean;
  overall: number;
  primary_reason: string;
  message: string;
  reasons: string[];
  reason_messages: string[];
  metrics: QualityMetrics;
  field_circle: FieldCircle;
  forced?: boolean;
  lens_detected?: boolean | null;
  low_accuracy_warning?: string | null;
}

export type GradeIndex = 0 | 1 | 2 | 3 | 4;

export interface GradeResult {
  score: number;
  tta_std: number;
  grade_index: GradeIndex;
  grade: string;
  confidence: number;
  probabilities: Record<string, number>;
  thresholds: number[];
  model: string;
  trained_on?: string | null;
  inference_ms: number;
}

export interface CamResult {
  overlay: string;
  grid: number[][];
}

export type LesionName = 'microaneurysm' | 'haemorrhage' | 'hard_exudate' | 'cotton_wool_spot';

export interface LesionResult {
  counts: Record<string, number>;
  area_pct: Record<string, number>;
  near_macula: Record<string, boolean>;
  overlay: string;
  colors: Record<string, string>;
  inference_ms: number;
  model?: string | null;
}

export type TierCode = 'retake' | 'unavailable' | 'second_look' | 'routine' | 'recheck' | 'refer' | 'refer_urgent';

export interface Tier {
  code: TierCode;
  label: string;
  action: string;
  follow_up_months: number | null;
  urgency: 'none' | 'low' | 'medium' | 'high';
}

export interface Timings {
  total: number;
  grader: number | null;
  lesions: number | null;
}

export type CropBox = [number, number, number, number];

export interface AnalyzeResponse {
  quality: QualityResult;
  crop_box: CropBox;
  image_size: [number, number];
  grade?: GradeResult;
  cam?: CamResult;
  lesions?: LesionResult;
  tier: Tier;
  why: string;
  timings_ms: Timings;
  disclaimer: string;
  eye: string;
  source: string;
}

/** The analyze response as stored in a screening record: image overlays are stripped. */
export type SavedPayload = Omit<AnalyzeResponse, 'cam' | 'lesions'> & {
  lesions?: Omit<LesionResult, 'overlay'>;
};

export interface ModelMeta {
  model?: string;
  trained_on?: string | null;
  val_metrics?: Record<string, number> | null;
  source?: string;
  classes?: string[];
  input_size?: number;
  [key: string]: unknown;
}

export interface ModelStatus {
  installed: boolean;
  size_mb: number;
  meta: ModelMeta;
}

export interface HealthResponse {
  ok: boolean;
  offline: boolean;
  models: {
    dr_model: ModelStatus;
    lesion_model: ModelStatus;
    quality_model?: ModelStatus;
  };
  lesion_colors: Record<string, string>;
  quality_reasons: Record<string, string>;
}

export type Eye = 'right' | 'left';
export type Source = 'upload' | 'camera';
export type ReportLang = 'en' | 'hi';

export interface SaveScreeningBody {
  image_data: string;
  result: AnalyzeResponse;
  eye: Eye;
  source: Source;
  site: string | null;
  worker: string | null;
  patient_id: string | null;
  patient_name: string | null;
  age: number | null;
  sex: string | null;
  diabetes_years: number | null;
  lang: ReportLang;
}

export interface QrPayload {
  text: string;
  summary: {
    id: string;
    grade: string | null;
    tier: TierCode | null;
    date: string;
    eye: string;
  };
}

export interface SaveScreeningResponse {
  id: string;
  qr: QrPayload;
}

export interface ScreeningRow {
  id: string;
  created_at: string;
  site: string | null;
  patient_id: string | null;
  patient_name: string | null;
  age: number | null;
  sex: string | null;
  eye: string;
  source: string;
  quality_state: QualityState | null;
  quality_overall: number | null;
  gradable: number;
  grade_index: GradeIndex | null;
  grade: string | null;
  confidence: number | null;
  tier: TierCode | null;
  second_look_status: 'none' | 'pending' | 'done';
  reviewer_grade: number | null;
  referral_completed_at: string | null;
}

export interface ScreeningDetail extends ScreeningRow {
  worker: string | null;
  diabetes_years: number | null;
  lang: ReportLang | null;
  score: number | null;
  quality_reasons: string[];
  lesion_counts: Record<string, number>;
  why: string | null;
  image_path: string;
  overlay_path: string | null;
  cam_path: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  payload: SavedPayload;
  qr: QrPayload;
}

export interface QrImageResponse {
  id: string;
  image: string;
}

export interface SecondLookDecision {
  grade_index: GradeIndex;
  note: string | null;
  reviewer: string | null;
}

export interface SecondLookResponse {
  id: string;
  tier: TierCode;
}

export interface SiteStats {
  site: string;
  n: number;
  ungradable: number;
  referred: number;
  completed: number;
}

export interface DayStats {
  day: string;
  n: number;
}

export interface DashboardSummary {
  total: number;
  ungradable: number;
  ungradable_rate: number;
  by_tier: Record<string, number>;
  by_grade: Record<string, number>;
  by_site: SiteStats[];
  by_day: DayStats[];
  quality_reasons: Record<string, number>;
  second_look_pending: number;
  referred: number;
  referral_completed: number;
}
