import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

const sphere = new SphereGeometry(1, 8, 6);
const cone = new ConeGeometry(1, 1, 6);
const cyl = new CylinderGeometry(1, 0.72, 1, 6);
const ico = new IcosahedronGeometry(1, 0);
const boxGeo = new CylinderGeometry(0.5, 0.5, 1, 4);

const baked = new Map<BufferGeometry, BufferGeometry>();

function nonIndexed(geo: BufferGeometry): BufferGeometry {
  let cached = baked.get(geo);
  if (!cached) {
    cached = geo.index ? geo.toNonIndexed() : geo;
    baked.set(geo, cached);
  }
  return cached;
}

const _v = new Vector3();
const _n = new Vector3();
const _nm = new Matrix3();

export function mergeParts(
  parts: { geo: BufferGeometry; matrix: Matrix4; color: Color }[],
): BufferGeometry {
  let count = 0;
  const geos = parts.map((p) => nonIndexed(p.geo));
  geos.forEach((g) => {
    count += g.getAttribute('position').count;
  });
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  parts.forEach((p, pi) => {
    const g = geos[pi];
    _nm.getNormalMatrix(p.matrix);
    const pa = g.getAttribute('position');
    const na = g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(p.matrix);
      if (na) _n.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize();
      else _n.set(0, 1, 0);
      const i3 = o * 3;
      pos[i3] = _v.x;
      pos[i3 + 1] = _v.y;
      pos[i3 + 2] = _v.z;
      nor[i3] = _n.x;
      nor[i3 + 1] = _n.y;
      nor[i3 + 2] = _n.z;
      col[i3] = p.color.r;
      col[i3 + 1] = p.color.g;
      col[i3 + 2] = p.color.b;
      o++;
    }
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  return out;
}

export function M(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): Matrix4 {
  const m = new Matrix4();
  m.compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
  return m;
}

export const UNIT = { sphere, cone, cyl, ico, box: boxGeo };

export function lambert(color: number): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, flatShading: true });
}

function mesh(geo: BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh {
  const m = new Mesh(geo, lambert(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

export interface FishOpts {
  length: number;
  height: number;
  color: number;
  belly?: number;
  bands?: number;
}

/** Fish faces +Z. Tail pivot is userData.tail. */
export function makeFish(opt: FishOpts): Group {
  const g = new Group();
  const L = opt.length;
  const H = opt.height;
  const body = mesh(sphere, opt.color, 0, 0, 0.02 * L, H * 0.36, H * 0.42, L * 0.46);
  g.add(body);
  if (opt.belly !== undefined) {
    const belly = mesh(sphere, opt.belly, 0, -H * 0.16, 0.04 * L, H * 0.24, H * 0.16, L * 0.34);
    g.add(belly);
  }
  if (opt.bands) {
    for (let i = 0; i < opt.bands; i++) {
      const z = L * 0.16 - i * L * 0.16;
      g.add(mesh(sphere, 0xf4f7f8, 0, 0, z, H * 0.4, H * 0.46, H * 0.07));
    }
  }
  const dorsal = mesh(sphere, opt.color, 0, H * 0.36, -L * 0.02, H * 0.08, H * 0.3, L * 0.14);
  g.add(dorsal);

  const tailPivot = new Group();
  tailPivot.position.set(0, 0, -L * 0.42);
  const tail = mesh(sphere, opt.color, 0, 0, -L * 0.16, H * 0.06, H * 0.42, L * 0.22);
  tailPivot.add(tail);
  g.add(tailPivot);
  g.userData.tail = tailPivot;

  const eyeWhite = 0xf7f7f7;
  const pupil = 0x1b1d20;
  for (const s of [-1, 1]) {
    g.add(mesh(sphere, eyeWhite, s * H * 0.2, H * 0.1, L * 0.32, H * 0.09, H * 0.09, H * 0.09));
    g.add(mesh(sphere, pupil, s * H * 0.24, H * 0.1, L * 0.38, H * 0.045, H * 0.045, H * 0.045));
  }
  return g;
}

export function makeTurtle(): Group {
  const g = new Group();
  g.add(mesh(sphere, 0xd7c4a0, 0, 0.05, 0, 0.72, 0.28, 0.55));
  const shell = mesh(sphere, 0x6e8f55, 0, 0.22, -0.02, 0.62, 0.32, 0.5);
  g.add(shell);
  g.add(mesh(sphere, 0x8aaa6e, 0, 0.4, -0.02, 0.22, 0.12, 0.18));
  g.add(mesh(sphere, 0xd7c4a0, 0, 0.05, 0.62, 0.16, 0.14, 0.2));
  for (const s of [-1, 1]) {
    const flip = new Group();
    flip.position.set(s * 0.28, 0.02, 0.18);
    const fin = mesh(sphere, 0xcbb892, s * 0.28, 0, 0, 0.34, 0.05, 0.16);
    flip.add(fin);
    g.add(flip);
    if (s < 0) g.userData.flipL = flip;
    else g.userData.flipR = flip;
  }
  const tail = new Group();
  tail.position.set(0, 0.02, -0.48);
  tail.add(mesh(sphere, 0xcbb892, 0, 0, -0.14, 0.05, 0.035, 0.18));
  g.add(tail);
  g.userData.tail = tail;
  return g;
}

export function makeManta(): Group {
  const g = new Group();
  g.add(mesh(sphere, 0x2c3544, 0, 0, 0, 0.7, 0.16, 1.15));
  g.add(mesh(sphere, 0xe7eef2, 0, -0.08, 0.05, 0.4, 0.08, 0.7));
  const wingL = new Group();
  const wingR = new Group();
  wingL.position.set(-0.4, 0, 0);
  wingR.position.set(0.4, 0, 0);
  wingL.add(mesh(sphere, 0x323c4e, -0.85, 0, 0, 0.95, 0.06, 0.7));
  wingR.add(mesh(sphere, 0x323c4e, 0.85, 0, 0, 0.95, 0.06, 0.7));
  g.add(wingL, wingR);
  const tail = new Group();
  tail.position.set(0, 0.02, -0.7);
  tail.add(mesh(sphere, 0x2c3544, 0, 0, -0.45, 0.08, 0.05, 0.55));
  g.add(tail);
  g.add(mesh(sphere, 0x222833, -0.18, 0.02, 0.85, 0.1, 0.08, 0.28));
  g.add(mesh(sphere, 0x222833, 0.18, 0.02, 0.85, 0.1, 0.08, 0.28));
  for (const s of [-1, 1]) {
    g.add(mesh(sphere, 0xf4f7f8, s * 0.18, 0.06, 0.55, 0.06, 0.06, 0.06));
  }
  g.userData.wingL = wingL;
  g.userData.wingR = wingR;
  g.userData.tail = tail;
  return g;
}

export function makeOctopus(): Group {
  const g = new Group();
  const bodyMat = lambert(0x6b4c6e);
  const head = new Mesh(sphere, bodyMat);
  head.scale.set(0.42, 0.36, 0.42);
  head.position.y = 0.45;
  g.add(head);
  const legs: Group[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pivot = new Group();
    pivot.position.set(Math.cos(a) * 0.18, 0.22, Math.sin(a) * 0.18);
    pivot.rotation.y = -a;
    const leg = new Mesh(cyl, bodyMat);
    leg.scale.set(0.05, 0.7, 0.05);
    leg.position.y = -0.28;
    leg.rotation.x = 0.7;
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }
  for (const s of [-1, 1]) {
    const eye = mesh(sphere, 0xf3efe6, s * 0.14, 0.5, 0.28, 0.08, 0.09, 0.06);
    g.add(eye);
    g.add(mesh(sphere, 0x1a1a1a, s * 0.14, 0.5, 0.33, 0.035, 0.04, 0.03));
  }
  g.userData.legs = legs;
  g.userData.bodyMat = bodyMat;
  g.scale.setScalar(1.4);
  return g;
}

export function makeShark(): Group {
  const g = new Group();
  const bodyMat = lambert(0x5c6d7a);
  const body = new Mesh(sphere, bodyMat);
  body.scale.set(0.42, 0.4, 1.85);
  g.add(body);
  const snout = new Mesh(sphere, bodyMat);
  snout.scale.set(0.24, 0.2, 0.55);
  snout.position.set(0, -0.02, 1.55);
  g.add(snout);
  const belly = new Mesh(sphere, lambert(0xd5dde2));
  belly.scale.set(0.28, 0.16, 1.35);
  belly.position.set(0, -0.26, 0.15);
  g.add(belly);
  const dorsal = new Mesh(cone, bodyMat);
  dorsal.scale.set(0.12, 0.72, 0.28);
  dorsal.position.set(0, 0.72, 0.05);
  g.add(dorsal);
  for (const s of [-1, 1] as const) {
    const pecPivot = new Group();
    pecPivot.position.set(s * 0.42, -0.16, 0.35);
    const pec = new Mesh(sphere, bodyMat);
    pec.scale.set(0.55, 0.05, 0.22);
    pec.position.set(s * 0.28, 0, 0);
    pec.rotation.z = s * 0.35;
    pecPivot.add(pec);
    g.add(pecPivot);
    if (s < 0) g.userData.pecL = pecPivot;
    else g.userData.pecR = pecPivot;
    const eye = new Mesh(sphere, new MeshBasicMaterial({ color: 0x14181c }));
    eye.scale.set(0.06, 0.06, 0.06);
    eye.position.set(s * 0.28, 0.08, 1.35);
    g.add(eye);
  }
  const tailPivot = new Group();
  tailPivot.position.set(0, 0.02, -1.7);
  const fluke = new Mesh(sphere, bodyMat);
  fluke.scale.set(0.72, 0.06, 0.28);
  fluke.position.set(0, 0, -0.12);
  tailPivot.add(fluke);
  g.add(tailPivot);
  g.userData.tail = tailPivot;
  return g;
}

export function makeOrca(): Group {
  const g = new Group();
  const black = lambert(0x1c2128);
  const white = new MeshBasicMaterial({ color: 0xf4f7f8 });
  const body = new Mesh(sphere, black);
  body.scale.set(0.82, 0.7, 2.65);
  g.add(body);
  const belly = new Mesh(sphere, white);
  belly.scale.set(0.58, 0.34, 1.85);
  belly.position.set(0, -0.5, 0.05);
  g.add(belly);
  const jaw = new Mesh(sphere, white);
  jaw.scale.set(0.46, 0.24, 0.9);
  jaw.position.set(0, -0.42, 1.85);
  g.add(jaw);
  for (const s of [-1, 1] as const) {
    const patch = new Mesh(sphere, white);
    patch.scale.set(0.22, 0.46, 0.78);
    patch.position.set(s * 0.74, 0.12, 1.2);
    g.add(patch);
    const eye = new Mesh(sphere, new MeshBasicMaterial({ color: 0x141414 }));
    eye.scale.set(0.09, 0.09, 0.09);
    eye.position.set(s * 0.96, 0.18, 1.48);
    g.add(eye);
    const pec = new Mesh(sphere, black);
    pec.scale.set(0.62, 0.07, 0.26);
    pec.position.set(s * 0.9, -0.32, 0.35);
    pec.rotation.z = s * 0.55;
    g.add(pec);
  }
  const saddle = new Mesh(sphere, white);
  saddle.scale.set(0.52, 0.18, 0.72);
  saddle.position.set(0, 0.74, -0.15);
  g.add(saddle);
  const dorsal = new Mesh(cone, black);
  dorsal.scale.set(0.16, 1.2, 0.28);
  dorsal.position.set(0, 1.15, -0.05);
  g.add(dorsal);
  const tailPivot = new Group();
  tailPivot.position.set(0, 0.05, -2.35);
  const fluke = new Mesh(sphere, black);
  fluke.scale.set(1.15, 0.07, 0.34);
  fluke.position.set(0, 0, -0.12);
  tailPivot.add(fluke);
  g.add(tailPivot);
  g.userData.tail = tailPivot;
  return g;
}

const SUITS = [0x243044, 0x1c4f74, 0x157074, 0x3c7d70];

export function makeDiver(): Group {
  const g = new Group();
  const suit = lambert(SUITS[0]);
  const skin = lambert(0xe0b498);
  const finMat = lambert(0x7af6e4);
  const accent = lambert(0xe36a3c);
  // The camera stays on the diver, so fog is off and a depth tint can keep the
  // silhouette readable after the water goes near-black.
  for (const mat of [suit, skin, finMat, accent]) {
    mat.fog = false;
    mat.emissive.setHex(0x000000);
  }

  const torso = new Mesh(sphere, suit);
  torso.scale.set(0.34, 0.42, 0.2);
  torso.position.set(0, 1.18, 0);
  g.add(torso);

  const hips = new Mesh(sphere, suit);
  hips.scale.set(0.26, 0.18, 0.16);
  hips.position.set(0, 0.82, 0);
  g.add(hips);

  const head = new Mesh(sphere, skin);
  head.scale.set(0.15, 0.17, 0.15);
  head.position.set(0, 1.62, 0);
  g.add(head);

  const mask = new Mesh(sphere, lambert(0x142028));
  mask.scale.set(0.13, 0.08, 0.08);
  mask.position.set(0, 1.62, 0.1);
  g.add(mask);
  const strap = new Mesh(sphere, accent);
  strap.scale.set(0.16, 0.04, 0.16);
  strap.position.set(0, 1.66, 0);
  g.add(strap);

  function limb(side: number, y: number, z: number, len: number, thick: number, mat: MeshLambertMaterial): Group {
    const pivot = new Group();
    pivot.position.set(side, y, z);
    const part = new Mesh(sphere, mat);
    part.scale.set(thick, len * 0.5, thick * 0.8);
    part.position.y = -len * 0.45;
    pivot.add(part);
    g.add(pivot);
    return pivot;
  }

  const armL = limb(-0.28, 1.28, 0, 0.55, 0.07, suit);
  const armR = limb(0.28, 1.28, 0, 0.55, 0.07, suit);
  const legL = limb(-0.1, 0.78, 0, 0.62, 0.08, suit);
  const legR = limb(0.1, 0.78, 0, 0.62, 0.08, suit);

  const fins: Mesh[] = [];
  for (const leg of [legL, legR]) {
    const fin = new Mesh(sphere, finMat);
    fin.scale.set(0.14, 0.028, 0.46);
    fin.position.set(0, -0.64, -0.06);
    leg.add(fin);
    fins.push(fin);
  }

  g.userData.suit = suit;
  g.userData.skin = skin;
  g.userData.finMat = finMat;
  g.userData.accent = accent;
  g.userData.fins = fins;
  g.userData.armL = armL;
  g.userData.armR = armR;
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

/** A teal edge that is already readable in daylight and stronger in the deep. */
export function shadeDiver(diver: Group, depth: number): void {
  const k = Math.max(0, Math.min(1, (depth - 6) / 30));
  const suit = diver.userData.suit as MeshLambertMaterial;
  const skin = diver.userData.skin as MeshLambertMaterial;
  const finMat = diver.userData.finMat as MeshLambertMaterial;
  const accent = diver.userData.accent as MeshLambertMaterial;
  suit.fog = false;
  skin.fog = false;
  finMat.fog = false;
  accent.fog = false;
  suit.emissive.setHex(0x3ec4d8);
  // Stronger than the shallows so the suit still reads, short of clipping into the pale floor.
  suit.emissiveIntensity = 0.5 + k * 0.65;
  skin.emissive.setHex(0xd9a07c);
  skin.emissiveIntensity = 0.16 + k * 0.35;
  finMat.emissive.setHex(0x9af8ea);
  finMat.emissiveIntensity = 0.28 + k * 0.45;
  accent.emissive.setHex(0xff8a55);
  accent.emissiveIntensity = 0.18 + k * 0.5;
}

export function tintDiver(diver: Group, suitLevel: number, finLevel: number): void {
  const suit = diver.userData.suit as MeshLambertMaterial;
  suit.color.set(SUITS[Math.max(0, Math.min(3, suitLevel))]);
  const stretch = 1 + finLevel * 0.12;
  for (const fin of diver.userData.fins as Mesh[]) {
    fin.scale.set(0.14 * (1 + finLevel * 0.04), 0.028, 0.46 * stretch);
  }
}

/** Arm, leg, and whole-body pitch for one frame of the kick. Collision uses the same numbers. */
export function diverStroke(kicking: boolean, burst: boolean, phase: number): { arm: number; leg: number; wobble: number } {
  const window = burst ? 0.7 : 0.85;
  const u = kicking ? Math.min(1, (phase % 1) / window) : 0;
  const sweep = Math.sin(u * Math.PI);
  const amp = burst ? 1.2 : kicking ? 1.05 : 0.08;
  const base = kicking ? -0.2 : 0.25;
  return {
    arm: kicking ? -0.28 - sweep * 0.4 : -0.9,
    leg: base - sweep * amp,
    wobble: kicking ? Math.sin((phase % 1) * Math.PI * 2) * (burst ? 0.1 : 0.07) : 0,
  };
}

/**
 * Standing idle on the sand. In the water both fins sweep together.
 * `phase` is the stroke clock: 0 is the hit, and the blade travels through about 70°.
 */
export function animateDiver(diver: Group, time: number, kicking: boolean, burst: boolean, phase = 0): void {
  const legL = diver.userData.legL as Group;
  const legR = diver.userData.legR as Group;
  const armL = diver.userData.armL as Group;
  const armR = diver.userData.armR as Group;
  if (!diver.userData.swimming) {
    const s = Math.sin(time * 1.6);
    legL.rotation.x = s * 0.06;
    legR.rotation.x = -s * 0.06;
    armL.rotation.x = -s * 0.04;
    armR.rotation.x = s * 0.04;
    return;
  }
  const stroke = diverStroke(kicking, burst, phase);
  // Negative pitch lifts the blades toward the back, so the kick reads from the rear camera.
  legL.rotation.x = stroke.leg;
  legR.rotation.x = stroke.leg;
  armL.rotation.x = stroke.arm;
  armR.rotation.x = stroke.arm;
}

export function animateTail(group: Group, time: number, speed: number, phase = 0): void {
  const tail = group.userData.tail as Group | undefined;
  if (tail) {
    const beat = Math.sin(time * speed + phase);
    tail.rotation.y = beat * 0.85;
    tail.rotation.x = beat * 0.12;
  }
  const pecL = group.userData.pecL as Group | undefined;
  const pecR = group.userData.pecR as Group | undefined;
  if (pecL && pecR) {
    const w = Math.sin(time * speed * 0.85 + phase) * 0.38;
    pecL.rotation.x = w;
    pecR.rotation.x = w;
  }
  const wingL = group.userData.wingL as Group | undefined;
  const wingR = group.userData.wingR as Group | undefined;
  if (wingL && wingR) {
    const w = Math.sin(time * 2.4 + phase) * 0.5;
    wingL.rotation.z = w;
    wingR.rotation.z = -w;
  }
  const flipL = group.userData.flipL as Group | undefined;
  const flipR = group.userData.flipR as Group | undefined;
  if (flipL && flipR) {
    const w = Math.sin(time * 3.1 + phase) * 0.85;
    flipL.rotation.z = 0.35 + w;
    flipR.rotation.z = -0.35 - w;
  }
  const legs = group.userData.legs as Group[] | undefined;
  const bodyMat = group.userData.bodyMat as MeshLambertMaterial | undefined;
  if (legs) {
    legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(time * 1.4 + i) * 0.35;
    });
  }
  if (bodyMat && group.userData.displayColor) {
    bodyMat.color.set(group.userData.displayColor as number);
  }
}
