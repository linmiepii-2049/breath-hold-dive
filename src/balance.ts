import type { GearId } from './types';

/** All tunables live here so the README and the sim can't drift apart. */
export const BALANCE = {
  maxGear: 3,
  costs: {
    fins: [60, 160, 380],
    lens: [90, 200, 420],
    suit: [110, 240, 500],
  } as Record<GearId, number[]>,
  /** Extra horizontal speed per fin level. */
  finsSpeed: 0.14,
  finsVertical: 0.1,
  /** O2 drain reduction per wetsuit level. */
  suitDrain: 0.09,
  /** [min fov, max fov] degrees. Wider and longer with each lens level. */
  lensFov: [
    [34, 62],
    [26, 72],
    [20, 82],
    [15, 90],
  ] as const,
  baseMaxO2: 100,
  lungCap: 0.3,
  effCap: 0.15,
  /** Drain per second at the surface, before depth, suit, and efficiency. */
  o2Base: 0.82,
  o2PerMeter: 0.04,
  /** Shallow band where drain pauses. A breath refills only when the head breaks the surface. */
  surfaceDepth: 1.25,
  /** Head y at or above this is a breath. The surface clamp puts the head near -0.33. */
  headSurfaceY: -0.45,
  /** Passive lift above this depth, none on it, sink below it. */
  neutralDepth: 12,
  /** Upward acceleration at the surface, fading to zero at neutralDepth. */
  riseAccel: 1.15,
  /** Downward acceleration once sinkRamp meters past neutral. */
  sinkAccel: 1.7,
  sinkRamp: 16,
  /** Passive float speed near the surface. Matches riseAccel / waterDrag. */
  terminalRise: 1.25,
  /** Passive free-fall once the sink is fully on. Matches sinkAccel / waterDrag. */
  terminalSink: 1.85,
  /** How fast speed bleeds off in water. Higher glides less. */
  waterDrag: 0.92,
  /** Forward acceleration while Space is held, before fins. */
  kickAccel: 3.15,
  /** Forward acceleration during the F kick. */
  sprintAccel: 5.7,
  /** Radians per mouse pixel at sensitivity 1. Right decreases yaw; up increases pitch. */
  lookYaw: 0.00115,
  lookPitch: 0.00095,
  pitchLimit: (80 * Math.PI) / 180,
  /** Association minimum. Below this the frame is returned and pays nothing. */
  minAccept: 60,
  burstDrain: 2.35,
  burstMult: 1.82,
  burstTime: 1.15,
  burstCd: 3.2,
  swim: 3.55,
  vertical: 2.4,
  film: 5,
  trainsPerDay: 2,
  breathSeconds: 46,
  apneaSeconds: 42,
  /** Lung gain at 100% rhythm accuracy. */
  breathGain: 0.08,
  /** Efficiency gain for a perfect apnea hold. */
  apneaGain: 0.05,
  hitStamina: 36,
  blackoutStamina: 50,
  hitFine: 45,
  blackoutFine: 70,
  /** Fraction of non-best photos added to the payout. */
  otherPhotoPay: 0.25,
  followDist: 11,
  shotCooldown: 0.45,
  grace: 3.5,
};

export function maxOxygen(lung: number): number {
  return BALANCE.baseMaxO2 * (1 + lung);
}

export function o2Drain(depth: number, suit: number, efficiency: number, burst: boolean): number {
  if (depth < BALANCE.surfaceDepth) return 0;
  let rate =
    (BALANCE.o2Base + depth * BALANCE.o2PerMeter) *
    (1 - BALANCE.suitDrain * suit) *
    (1 - efficiency);
  if (burst) rate *= BALANCE.burstDrain;
  return rate;
}

/** Positive lifts the diver. Zero at the neutral depth. Negative is the free-fall. */
export function buoyancyAccel(depth: number): number {
  const neutral = BALANCE.neutralDepth;
  if (depth <= neutral) return BALANCE.riseAccel * ((neutral - depth) / neutral);
  const t = Math.min(1, (depth - neutral) / BALANCE.sinkRamp);
  return -BALANCE.sinkAccel * t;
}

export function headAtSurface(feetY: number): boolean {
  return feetY + 1.55 >= BALANCE.headSurfaceY;
}

export function swimSpeed(fins: number, burst: boolean): number {
  const s = BALANCE.swim * (1 + BALANCE.finsSpeed * fins);
  return burst ? s * BALANCE.burstMult : s;
}

export function verticalSpeed(fins: number): number {
  return BALANCE.vertical * (1 + BALANCE.finsVertical * fins);
}

export function nextCost(id: GearId, level: number): number | null {
  if (level >= BALANCE.maxGear) return null;
  return BALANCE.costs[id][level];
}

/** 35mm-style label so the viewfinder feels like a lens, not a FOV slider. */
export function focalMm(fovDeg: number): number {
  return Math.round(35 * (40 / fovDeg));
}

export function prizeForScore(score: number): number {
  if (score < BALANCE.minAccept) return 0;
  const t = Math.max(0, Math.min(100, score)) / 100;
  return Math.round(36 * t + 300 * t * t);
}
