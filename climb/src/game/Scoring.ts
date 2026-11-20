/**
 * Stage grading against a "guide standard" time, expressed on a real-world scale
 * (Sherpa / guide / expedition member / commercial client) rather than a raw score.
 * Standard times are game hours, measured from autopilot runs that climb steadily
 * and rest only when spent.
 */
export interface StageStd {
  /** camp stages: departure → camp; summit: departure → summit */
  up: number;
  /** summit stages only: departure → back at the top camp */
  round?: number;
}

export const STANDARD: Record<string, StageStd> = {
  'everest-1': { up: 4.9 },
  'everest-2': { up: 3.5 },
  'everest-3': { up: 5.2 },
  'everest-4': { up: 5.1 },
  'everest-summit': { up: 9.5, round: 15.7 },
  'k2-1': { up: 5.9 },
  'k2-2': { up: 3.6 },
  'k2-3': { up: 3.5 },
  'k2-4': { up: 2.7 },
  'k2-summit': { up: 9.9, round: 15.5 },
};

export interface Grade { name: string; tone: 'top' | 'good' | 'ok' | 'slow' }

export function gradeFor(ratio: number): Grade {
  if (ratio <= 0.9) return { name: 'シェルパ級', tone: 'top' };
  if (ratio <= 1.05) return { name: 'ガイド級', tone: 'good' };
  if (ratio <= 1.25) return { name: '遠征隊員級', tone: 'ok' };
  return { name: '公募隊の顧客級', tone: 'slow' };
}

export function formatDur(hours: number): string {
  const m = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, '0')}分`;
}

const KEY = 'dz8000-records-v1';

type Records = Record<string, number>;

function read(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Records) : {};
  } catch {
    return {};
  }
}

export function bestFor(key: string): number | null {
  const v = read()[key];
  return typeof v === 'number' ? v : null;
}

/** Store if it beats the record; returns true for a new best. */
export function submitTime(key: string, hours: number): boolean {
  const r = read();
  const prev = r[key];
  if (typeof prev === 'number' && prev <= hours) return false;
  r[key] = hours;
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode: records just don't persist */ }
  return true;
}
