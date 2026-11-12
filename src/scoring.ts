import { PerspectiveCamera, Vector3 } from 'three';
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

/**
 * Focus bracket, in NDC. 0.34 is about a third of the frame and still holds a
 * subject placed on the thirds. The viewfinder draws this box.
 */
export const AIM_HALF = 0.34;
/** Farther than this, a creature is scenery. The viewfinder will not lock it. */
export const MAX_SUBJECT_DISTANCE = 22;

/**
 * Center inside the bracket, or a solid body that overlaps it by most of its size
 * and whose center is only just outside the edge. A school cloud only counts
 * when its center is inside. NDC, so the drawing-buffer scale does not matter.
 */
export function inAimZone(s: FrameSubject, half = AIM_HALF): boolean {
  if (!s.inFront || Math.abs(s.ndcX) > 1.05 || Math.abs(s.ndcY) > 1.05) return false;
  if (Math.abs(s.ndcX) <= half && Math.abs(s.ndcY) <= half) return true;
  const rx = Math.max(0.02, s.radiusNdcX);
  const ry = Math.max(0.02, s.radiusNdcY);
  if (Math.max(rx, ry) >= 0.42) return false;
  if (Math.abs(s.ndcX) > half + 0.08 || Math.abs(s.ndcY) > half + 0.08) return false;
  const overlapX = Math.min(s.ndcX + rx, AIM_HALF) - Math.max(s.ndcX - rx, -AIM_HALF);
  const overlapY = Math.min(s.ndcY + ry, AIM_HALF) - Math.max(s.ndcY - ry, -AIM_HALF);
  if (overlapX <= 0 || overlapY <= 0) return false;
  return overlapX / (2 * rx) >= 0.55 && overlapY / (2 * ry) >= 0.55;
}

/** Motion credit. Distance stays in composition and danger, not in this line. */
const ACTION_MOMENT = 10;

/**
 * The collision sphere is larger than the shell you can see. Lock only when the
 * reticle is inside about 70% of that sphere, as an ellipse, so open water
 * beside a turtle does not count as the body covering the bracket center.
 */
const BODY_SILHOUETTE = 0.7;

function coversReticle(s: FrameSubject): boolean {
  if (!s.inFront || s.fill < 0.04) return false;
  if (Math.abs(s.ndcX) > 1.2 || Math.abs(s.ndcY) > 1.2) return false;
  const rx = s.radiusNdcX * BODY_SILHOUETTE;
  const ry = s.radiusNdcY * BODY_SILHOUETTE;
  if (rx < 1e-4 || ry < 1e-4) return false;
  const nx = s.ndcX / rx;
  const ny = s.ndcY / ry;
  return nx * nx + ny * ny <= 1;
}

/** The moment animal has to be plainly in the picture, not a speck, a haze blob, or a shape behind weed. */
function momentWorthy(s: FrameSubject): boolean {
  if (!s.moment || !inFrame(s)) return false;
  const orca = s.species === 'orca' || s.moment === 'orcaPass';
  if (s.clarity < (orca ? 0.62 : 0.55)) return false;
  // A turtle at the prompt's range (~16 m, default lens) fills about a tenth of the frame.
  if (s.fill < (orca ? 0.24 : 0.085)) return false;
  const limit = orca ? 0.62 : 0.74;
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

/** A creature in the water, before it is projected. */
export interface AimCreature {
  species: SpeciesId;
  rarity: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  optimal: number;
  moment: MomentId | null;
  dangerous: boolean;
  acting: boolean;
}

const projectVec = new Vector3();
const projectForward = new Vector3();

/**
 * The one subject for this camera and this frame. NDC comes from the camera
 * matrices only, so a 0.35 render scale and a full-resolution buffer pick
 * the same animal when the CSS aspect is the same.
 */
export function computeSubject(
  camera: PerspectiveCamera,
  creatures: AimCreature[],
  options?: { fog?: number; visibility?: (c: AimCreature, dist: number) => number; aimHalf?: number },
): { subject: FrameSubject | null; frames: FrameSubject[] } {
  const frames = projectFrame(camera, creatures, options?.fog ?? 0, options?.visibility);
  return { subject: pickFromFrame(frames, options?.aimHalf), frames };
}

function projectFrame(
  camera: PerspectiveCamera,
  creatures: AimCreature[],
  fog: number,
  visibility?: (c: AimCreature, dist: number) => number,
): FrameSubject[] {
  camera.updateMatrixWorld();
  camera.getWorldDirection(projectForward);
  const forward = projectForward;
  const half = (camera.fov * Math.PI) / 360;
  const tanHalf = Math.tan(half) || 1e-4;
  const out: FrameSubject[] = [];
  for (const s of creatures) {
    const dx = s.x - camera.position.x;
    const dy = s.y - camera.position.y;
    const dz = s.z - camera.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dx * forward.x + dy * forward.y + dz * forward.z < 0.25) continue;
    if (dist < 0.35 || dist > MAX_SUBJECT_DISTANCE) continue;
    const fogT = Math.exp(-((fog * dist) ** 2));
    if (fogT < 0.16) continue;
    projectVec.set(s.x, s.y, s.z).project(camera);
    const fill = s.radius / (dist * tanHalf);
    const vis = visibility ? visibility(s, dist) : 1;
    const clarity = clamp(fogT * (0.2 + 0.8 * vis), 0, 1);
    out.push({
      species: s.species,
      rarity: s.rarity,
      inFront: true,
      ndcX: projectVec.x,
      ndcY: projectVec.y,
      fill,
      radiusNdcX: fill / Math.max(0.2, camera.aspect),
      radiusNdcY: fill,
      distance: dist,
      optimal: s.optimal,
      moment: s.moment,
      dangerous: s.dangerous,
      acting: s.acting,
      clarity,
    });
  }
  return out;
}

/**
 * The one subject the reticle, the focus label, and the score all use.
 * A still animal is a subject. Motion only changes the moment line.
 */
export function pickFromFrame(subjects: FrameSubject[], half = AIM_HALF): FrameSubject | null {
  // The creature nearest the bracket centre. A larger body that merely covers
  // the reticle does not beat a smaller one whose centre is closer.
  let best: FrameSubject | null = null;
  let bestOff = 1e9;
  for (const s of subjects) {
    if (!inFrame(s)) continue;
    if (!coversReticle(s) && !inAimZone(s, half)) continue;
    const off = Math.hypot(s.ndcX, s.ndcY);
    if (off < bestOff) {
      bestOff = off;
      best = s;
    }
  }
  // A sardine on the reticle must not steal a school whose center is in the bracket.
  if (best?.species === 'sardine' && best.rarity < 14) {
    const cloud = subjects.find(
      (s) => s.species === 'sardine' && s.rarity >= 14 && inFrame(s) && (coversReticle(s) || inAimZone(s, half)),
    );
    if (cloud) return cloud;
  }
  return best;
}

/** @deprecated Use pickFromFrame. Kept so older call sites stay on the same rule. */
export function pickSubject(subjects: FrameSubject[]): FrameSubject | null {
  return pickFromFrame(subjects);
}

export function scoreFrame(input: ScoreInput): ScoreBreakdown {
  const best = pickFromFrame(input.subjects);
  const bestComp = best ? compositionOf(best) : 0;

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
  let momentNote: ScoreBreakdown['momentNote'] = 'none';
  // The special moment belongs to the aimed animal, not to whoever else is in the corner.
  if (best.moment && momentWorthy(best)) {
    moment = best.fill >= 0.22 && bestComp >= 8 ? 25 : 12;
    momentId = best.moment;
    momentNote = 'special';
  } else if (best.acting) {
    // Any creature that is actually moving earns the motion line. How far it is
    // already changed composition and the distance score.
    moment = ACTION_MOMENT;
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
