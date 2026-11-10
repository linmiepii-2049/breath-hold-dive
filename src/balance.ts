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
  /** Shallow band where drain pauses (player is at the surface, breath not refilled). */
  surfaceDepth: 1.25,
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
  /** Keyboard yaw while A or D is held. About 105° per second, no snap. */
  turnRate: 1.83,
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
  const t = Math.max(0, Math.min(100, score)) / 100;
  return Math.round(36 * t + 300 * t * t);
}
