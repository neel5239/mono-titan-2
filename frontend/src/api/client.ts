import type {
  AnalyzeResponse,
  DashboardSummary,
  Eye,
  HealthResponse,
  QrImageResponse,
  QualityResult,
  SaveScreeningBody,
  SaveScreeningResponse,
  ScreeningDetail,
  ScreeningRow,
  SecondLookDecision,
  SecondLookResponse,
  Source,
} from './types';

export class ApiError extends Error {
  status: number | null;
  network: boolean;
  constructor(message: string, status: number | null, network = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.network = network;
  }
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && e.network;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('Server unreachable', null, true);
  }
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (body.detail) detail = JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),

  quality: (file: File, source: 'upload' | 'camera' = 'upload') => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('source', source);
    return request<QualityResult>('/api/quality', { method: 'POST', body: fd });
  },

  analyze: (file: File, eye: Eye, source: Source, force: boolean) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('eye', eye);
    fd.append('source', source);
    fd.append('force', force ? 'true' : 'false');
    return request<AnalyzeResponse>('/api/analyze', { method: 'POST', body: fd });
  },

  saveScreening: (body: SaveScreeningBody) => request<SaveScreeningResponse>('/api/screenings', json('POST', body)),

  listScreenings: (limit = 200, tier?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (tier) q.set('tier', tier);
    return request<ScreeningRow[]>(`/api/screenings?${q.toString()}`);
  },

  getScreening: (id: string) => request<ScreeningDetail>(`/api/screenings/${encodeURIComponent(id)}`),

  qr: (id: string) => request<QrImageResponse>(`/api/qr/${encodeURIComponent(id)}`),

  secondLookQueue: () => request<ScreeningRow[]>('/api/second-look'),

  decideSecondLook: (id: string, body: SecondLookDecision) =>
    request<SecondLookResponse>(`/api/second-look/${encodeURIComponent(id)}`, json('POST', body)),

  referralComplete: (id: string) =>
    request<{ ok: boolean }>(`/api/screenings/${encodeURIComponent(id)}/referral-complete`, { method: 'POST' }),

  deleteScreening: (id: string) => request<{ ok: boolean }>(`/api/screenings/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  dashboard: () => request<DashboardSummary>('/api/dashboard/summary'),
};
