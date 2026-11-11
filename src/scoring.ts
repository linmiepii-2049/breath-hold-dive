import { prizeForScore } from './balance';
import type { CommentId, MomentId, SpeciesId } from './types';
import { clamp } from './util';

export interface FrameSubject {
  species: SpeciesId;
  rarity: number;
  inFront: boolean;
  ndcX: number;
  ndcY: number;
  /** Diameter as a fraction of frame height. 1 = subject as tall as the frame. */
  fill: number;
  radiusNdcX: number;
  radiusNdcY: number;
  distance: number;
  optimal: number;
  moment: MomentId | null;
  dangerous: boolean;
  /** Swimming, turning, feeding, or otherwise acting. Idle drifting is false. */
  acting: boolean;
  /** 1 = unobstructed and not lost in haze. */
  clarity: number;
}

export interface ScoreInput {
  subjects: FrameSubject[];
  depth: number;
  nearestPredator: number;
}

export interface ScoreBreakdown {
  composition: number;
  rarity: number;
  moment: number;
  distanceDanger: number;
  total: number;
  species: SpeciesId | null;
  momentId: MomentId | null;
  /** Why the moment line scored. `action` is the base for a clear moving subject. */
  momentNote: 'none' | 'action' | 'special';
  comment: CommentId;
  prize: number;
}

function inFrame(s: FrameSubject): boolean {
  return s.inFront && Math.abs(s.ndcX) <= 1 && Math.abs(s.ndcY) <= 1 && s.fill >= 0.04;
}

function compositionOf(s: FrameSubject): number {
  if (!inFrame(s)) return 0;
  const thirds: Array<[number, number]> = [
    [-1 / 3, -1 / 3],
    [-1 / 3, 1 / 3],
    [1 / 3, -1 / 3],
    [1 / 3, 1 / 3],
  ];
  let best = 99;
  for (const [x, y] of thirds) {
    const d = Math.hypot(s.ndcX - x, s.ndcY - y);
    if (d < best) best = d;
  }
  const thirdsPts = 12 * (1 - clamp(best / 0.72, 0, 1));

  let sizePts: number;
  if (s.fill < 0.12) sizePts = (s.fill / 0.12) * 10;
  else if (s.fill <= 0.5) sizePts = 10;
  else sizePts = 10 * (1 - clamp((s.fill - 0.5) / 0.55, 0, 1));

  const full =
    Math.abs(s.ndcX) + s.radiusNdcX < 0.97 && Math.abs(s.ndcY) + s.radiusNdcY < 0.97;
  const framePts = full ? 8 : 3.5;
  let raw = thirdsPts + sizePts + framePts;
  // A readable subject that is already well placed gets the rest of the
  // composition line, so a common animal can reach the pass. Cropped or
  // off-center frames do not.
  if (raw >= 22 && s.fill >= 0.12 && full) raw = 30;
  return clamp(raw, 0, 30);
}

function distancePoints(s: FrameSubject): number {
  const ratio = s.distance / Math.max(0.5, s.optimal);
  if (ratio < 0.42) return 6;
  if (ratio <= 1.35) return 10;
  if (ratio < 2.5) return 10 * (1 - (ratio - 1.35) / 1.15);
  return 1.5;
}

/** A clear, framed shot of a creature that is actually doing something. */
const ACTION_MOMENT = 10;

function actionWorthy(s: FrameSubject): boolean {
  if (!s.acting || !inFrame(s)) return false;
  if (s.clarity < 0.62 || s.fill < 0.12) return false;
  return compositionOf(s) >= 12;
}

/** The moment animal has to be plainly in the picture, not a speck, a haze blob, or a shape behind weed. */
function momentWorthy(s: FrameSubject): boolean {
  if (!s.moment || !inFrame(s)) return false;
  if (s.clarity < 0.62) return false;
  const orca = s.species === 'orca' || s.moment === 'orcaPass';
  if (s.fill < (orca ? 0.24 : 0.18)) return false;
  const limit = orca ? 0.62 : 0.86;
  if (Math.abs(s.ndcX) > limit || Math.abs(s.ndcY) > limit) return false;
  const edgeX = Math.abs(s.ndcX) + s.radiusNdcX * 0.45;
  const edgeY = Math.abs(s.ndcY) + s.radiusNdcY * 0.45;
  return edgeX < 1.02 && edgeY < 1.02;
}

/** Full credit when the subject is easy to see. Heavy haze or occlusion cuts the score. */
function seenFactor(clarity: number): number {
  if (clarity >= 0.75) return 1;
  if (clarity <= 0.15) return 0.3;
  return 0.3 + ((clarity - 0.15) / 0.6) * 0.7;
}

/**
 * Who the shutter is aimed at. A small animal on the reticle beats a larger
 * one toward the edge, and a closer animal beats a bigger one at the same aim.
 */
function aimWeight(s: FrameSubject): number {
  const off = Math.hypot(s.ndcX, s.ndcY);
  const body = Math.max(0.05, Math.hypot(s.radiusNdcX, s.radiusNdcY));
  const onReticle = off <= Math.max(0.16, body * 0.7);
  const center = 1 / (0.1 + off * off);
  const closeness = 1 / Math.max(0.45, s.distance);
  return (onReticle ? 6 : 1) * center * closeness * (0.35 + s.clarity);
}

export function scoreFrame(input: ScoreInput): ScoreBreakdown {
  let best: FrameSubject | null = null;
  let bestWeight = -1;
  let bestComp = 0;
  for (const s of input.subjects) {
    if (!inFrame(s)) continue;
    const weight = aimWeight(s);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = s;
      bestComp = compositionOf(s);
    }
  }

  if (!best) {
    return {
      composition: 0,
      rarity: 0,
      moment: 0,
      distanceDanger: 0,
      total: 0,
      species: null,
      momentId: null,
      momentNote: 'none',
      comment: 'empty',
      prize: 0,
    };
  }

  const seen = seenFactor(best.clarity);
  const composition = Math.round(clamp(bestComp * seen, 0, 30));
  let rarityRaw = best.fill < 0.07 ? best.rarity * 0.5 : best.rarity;
  if (best.species === 'orca' && (best.fill < 0.24 || best.clarity < 0.62)) rarityRaw *= 0.35;
  rarityRaw *= seen;
  const rarity = Math.round(clamp(rarityRaw, 0, 25));

  let moment = 0;
  let momentId: MomentId | null = null;
  let momentFill = -1;
  let momentNote: ScoreBreakdown['momentNote'] = 'none';
  for (const s of input.subjects) {
    if (!momentWorthy(s) || !s.moment) continue;
    const pts = s.fill >= 0.22 && compositionOf(s) >= 8 ? 25 : 12;
    if (pts > moment || (pts === moment && s.fill > momentFill)) {
      moment = pts;
      momentId = s.moment;
      momentFill = s.fill;
      momentNote = 'special';
    }
  }
  if (moment < ACTION_MOMENT && actionWorthy(best)) {
    moment = ACTION_MOMENT;
    momentId = null;
    momentNote = 'action';
  }

  const distPart = distancePoints(best);
  let danger = clamp(input.depth / 38, 0, 1) * 5;
  if (input.nearestPredator < 7) danger += 5;
  else if (input.nearestPredator < 14) danger += 3;
  if (best.dangerous) danger += 2;
  danger = clamp(danger, 0, 10);
  const distanceDanger = Math.round(clamp(distPart + danger, 0, 20));
  const total = composition + rarity + moment + distanceDanger;
  const comment = pickComment({
    total,
    composition,
    rarity,
    moment,
    danger,
    depth: input.depth,
    species: best.species,
    predator: input.nearestPredator,
    dangerous: best.dangerous,
  });

  return {
    composition,
    rarity,
    moment,
    distanceDanger,
    total,
    species: best.species,
    momentId,
    momentNote,
    comment,
    prize: prizeForScore(total),
  };
}

function pickComment(s: {
  total: number;
  composition: number;
  rarity: number;
  moment: number;
  danger: number;
  depth: number;
  species: SpeciesId;
  predator: number;
  dangerous: boolean;
}): CommentId {
  if (s.total < 10) return 'empty';
  if (s.moment >= 20) return 'moment';
  if (s.dangerous && s.predator < 8) return 'danger';
  if (s.danger >= 7 && s.depth > 22) return 'deep';
  if (s.composition >= 24 && s.total >= 68) return 'excellent';
  if (s.rarity >= 20 && s.composition < 16) return 'rare';
  if (s.species === 'sardine' && s.rarity >= 11 && s.composition >= 14) return 'school';
  if (s.total < 34 && s.composition < 14) return 'closer';
  if (s.composition < 15) return 'framing';
  return 'solid';
}
