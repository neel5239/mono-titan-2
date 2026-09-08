import type { LesionName, TierCode } from '../api/types';

export const LESION_ORDER: LesionName[] = ['microaneurysm', 'haemorrhage', 'hard_exudate', 'cotton_wool_spot'];

export const GRADE_NAMES = ['No apparent DR', 'Mild NPDR', 'Moderate NPDR', 'Severe NPDR', 'Proliferative DR'] as const;

export const TIER_ORDER: TierCode[] = ['routine', 'recheck', 'refer', 'refer_urgent', 'second_look', 'retake', 'unavailable'];

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  return `${(v * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  return v.toFixed(digits);
}

function locale(lang: string): string {
  return lang === 'hi' ? 'hi-IN' : 'en-IN';
}

export function formatDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale(lang), { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale(lang), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateObj(d: Date, lang: string): string {
  return d.toLocaleDateString(locale(lang), { day: '2-digit', month: 'short', year: 'numeric' });
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

export function addDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
