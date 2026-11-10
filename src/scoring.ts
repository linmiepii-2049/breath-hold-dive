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
  if (s.fill < 0.16) sizePts = (s.fill / 0.16) * 10;
  else if (s.fill <= 0.46) sizePts = 10;
  else sizePts = 10 * (1 - clamp((s.fill - 0.46) / 0.6, 0, 1));

  const full =
    Math.abs(s.ndcX) + s.radiusNdcX < 0.97 && Math.abs(s.ndcY) + s.radiusNdcY < 0.97;
  const framePts = full ? 8 : 3.5;
  return clamp(thirdsPts + sizePts + framePts, 0, 30);
}

function distancePoints(s: FrameSubject): number {
  const ratio = s.distance / Math.max(0.5, s.optimal);
  if (ratio < 0.42) return 6;
  if (ratio <= 1.35) return 10;
  if (ratio < 2.5) return 10 * (1 - (ratio - 1.35) / 1.15);
  return 1.5;
}

/** The moment animal has to be plainly in the picture, not a speck at the edge. */
function momentWorthy(s: FrameSubject): boolean {
  if (!s.moment || !inFrame(s)) return false;
  if (s.fill < 0.18) return false;
  if (Math.abs(s.ndcX) > 0.86 || Math.abs(s.ndcY) > 0.86) return false;
  const edgeX = Math.abs(s.ndcX) + s.radiusNdcX * 0.45;
  const edgeY = Math.abs(s.ndcY) + s.radiusNdcY * 0.45;
  return edgeX < 1.02 && edgeY < 1.02;
}

export function scoreFrame(input: ScoreInput): ScoreBreakdown {
  let best: FrameSubject | null = null;
  let bestWeight = -1;
  let bestComp = 0;
  for (const s of input.subjects) {
    const comp = compositionOf(s);
    if (!inFrame(s)) continue;
    const readable = Math.min(1, s.fill / 0.16);
    const weight = comp * 1.15 + s.rarity * 0.55 * readable + Math.min(s.fill, 0.7) * 18 + (momentWorthy(s) ? 8 : 0);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = s;
      bestComp = comp;
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
      comment: 'empty',
      prize: 0,
    };
  }

  const composition = Math.round(clamp(bestComp, 0, 30));
  const rarity = Math.round(clamp(best.fill < 0.07 ? best.rarity * 0.5 : best.rarity, 0, 25));

  let moment = 0;
  let momentId: MomentId | null = null;
  let momentFill = -1;
  for (const s of input.subjects) {
    if (!momentWorthy(s) || !s.moment) continue;
    const pts = s.fill >= 0.22 && compositionOf(s) >= 8 ? 25 : 12;
    if (pts > moment || (pts === moment && s.fill > momentFill)) {
      moment = pts;
      momentId = s.moment;
      momentFill = s.fill;
    }
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
