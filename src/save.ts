import { BALANCE } from './balance';
import type { AlbumEntry, GearId, Lang } from './types';
import { clamp } from './util';

const KEY = 'breath-hold-dive-v1';

export interface SaveData {
  /** 2 keeps v1 progress. Album ties now keep the newer photo. */
  v: 1 | 2;
  lang: Lang;
  money: number;
  day: number;
  trainsToday: number;
  gear: Record<GearId, number>;
  lung: number;
  efficiency: number;
  album: Record<string, AlbumEntry>;
  bestScore: number;
  dives: number;
  muted: boolean;
}

export function defaultSave(): SaveData {
  return {
    v: 2,
    lang: 'zh',
    money: 0,
    day: 1,
    trainsToday: 0,
    gear: { fins: 0, lens: 0, suit: 0 },
    lung: 0,
    efficiency: 0,
    album: {},
    bestScore: 0,
    dives: 0,
    muted: false,
  };
}

function gearLevel(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return clamp(Math.floor(v), 0, BALANCE.maxGear);
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (data.v !== 1 && data.v !== 2) return defaultSave();
    const base = defaultSave();
    base.lang = data.lang === 'en' ? 'en' : 'zh';
    base.money = Math.max(0, Number(data.money) || 0);
    base.day = Math.max(1, Math.floor(Number(data.day) || 1));
    base.trainsToday = clamp(Math.floor(Number(data.trainsToday) || 0), 0, 9);
    base.gear = {
      fins: gearLevel(data.gear?.fins),
      lens: gearLevel(data.gear?.lens),
      suit: gearLevel(data.gear?.suit),
    };
    base.lung = clamp(Number(data.lung) || 0, 0, BALANCE.lungCap);
    base.efficiency = clamp(Number(data.efficiency) || 0, 0, BALANCE.effCap);
    base.bestScore = clamp(Number(data.bestScore) || 0, 0, 100);
    base.dives = Math.max(0, Math.floor(Number(data.dives) || 0));
    base.muted = Boolean(data.muted);
    if (data.album && typeof data.album === 'object') {
      for (const [k, entry] of Object.entries(data.album)) {
        if (!entry || typeof entry.score !== 'number') continue;
        base.album[k] = {
          score: clamp(entry.score, 0, 100),
          dataUrl: typeof entry.dataUrl === 'string' ? entry.dataUrl : '',
          comment: entry.comment ?? 'solid',
        };
      }
    }
    return base;
  } catch {
    return defaultSave();
  }
}

/** A new frame replaces a slot when it ties or beats the stored score. */
export function albumReplaces(previous: number | null, score: number): boolean {
  return previous == null || score >= previous;
}

export function writeSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    const slim: SaveData = { ...save, album: {} };
    for (const [k, entry] of Object.entries(save.album)) {
      slim.album[k] = { ...entry, dataUrl: '' };
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* quota exhausted; scores for this session still live in memory */
    }
  }
}
