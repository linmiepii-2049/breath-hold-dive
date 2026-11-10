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
  const body = mesh(sphere, opt.color, 0, 0, 0.05 * L, L * 0.48, H * 0.42, H * 0.32);
  g.add(body);
  if (opt.belly !== undefined) {
    const belly = mesh(sphere, opt.belly, 0, -H * 0.12, 0.05 * L, L * 0.36, H * 0.16, H * 0.22);
    g.add(belly);
  }
  if (opt.bands) {
    for (let i = 0; i < opt.bands; i++) {
      const z = -L * 0.05 + i * L * 0.16;
      g.add(mesh(sphere, 0xf4f7f8, 0, 0, z, H * 0.12, H * 0.44, H * 0.34));
    }
  }
  const dorsal = mesh(sphere, opt.color, 0, H * 0.32, -L * 0.02, H * 0.08, H * 0.28, L * 0.18);
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
  g.userData.tail = g.userData.flipL;
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
  g.add(mesh(sphere, 0x2c3544, 0, 0.02, -1.15, 0.08, 0.05, 0.55));
  g.add(mesh(sphere, 0x222833, -0.18, 0.02, 0.85, 0.1, 0.08, 0.28));
  g.add(mesh(sphere, 0x222833, 0.18, 0.02, 0.85, 0.1, 0.08, 0.28));
  for (const s of [-1, 1]) {
    g.add(mesh(sphere, 0xf4f7f8, s * 0.18, 0.06, 0.55, 0.06, 0.06, 0.06));
  }
  g.userData.wingL = wingL;
  g.userData.wingR = wingR;
  g.userData.tail = wingL;
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
  g.userData.tail = legs[0];
  return g;
}

export function makeShark(): Group {
  const g = makeFish({ length: 3.4, height: 0.85, color: 0x6a7b88, belly: 0xd5dde0 });
  const fin = mesh(cone, 0x5c6c78, 0, 0.55, -0.1, 0.16, 0.55, 0.16);
  fin.rotation.z = Math.PI;
  g.add(fin);
  g.add(mesh(sphere, 0x617280, -0.55, -0.05, 0.1, 0.38, 0.05, 0.22));
  g.add(mesh(sphere, 0x617280, 0.55, -0.05, 0.1, 0.38, 0.05, 0.22));
  return g;
}

export function makeOrca(): Group {
  const g = new Group();
  g.add(mesh(sphere, 0x16181c, 0, 0.1, 0, 1.15, 0.7, 2.5));
  g.add(mesh(sphere, 0xf2f4f6, 0, -0.22, 0.2, 0.7, 0.28, 1.5));
  g.add(mesh(sphere, 0xf2f4f6, -0.42, 0.28, 0.85, 0.22, 0.16, 0.32));
  g.add(mesh(sphere, 0xf2f4f6, 0.42, 0.28, 0.85, 0.22, 0.16, 0.32));
  const dorsal = mesh(cone, 0x121417, 0, 0.85, -0.15, 0.12, 0.85, 0.18);
  g.add(dorsal);
  const tailPivot = new Group();
  tailPivot.position.set(0, 0, -2.15);
  tailPivot.add(mesh(sphere, 0x16181c, 0, 0.15, -0.15, 0.85, 0.08, 0.28));
  g.add(tailPivot);
  for (const s of [-1, 1]) {
    g.add(mesh(sphere, 0xf7f7f7, s * 0.38, 0.22, 1.55, 0.1, 0.1, 0.1));
    g.add(mesh(sphere, 0x111111, s * 0.4, 0.22, 1.62, 0.05, 0.05, 0.05));
  }
  g.userData.tail = tailPivot;
  return g;
}

const SUITS = [0x243044, 0x1c4f74, 0x157074, 0x3c7d70];

export function makeDiver(): Group {
  const g = new Group();
  const suit = lambert(SUITS[0]);
  const skin = lambert(0xe0b498);
  const finMat = lambert(0x1ec2b4);
  const accent = lambert(0xe36a3c);

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
    fin.scale.set(0.16, 0.035, 0.34);
    fin.position.set(0, -0.62, 0.08);
    leg.add(fin);
    fins.push(fin);
  }

  g.userData.suit = suit;
  g.userData.fins = fins;
  g.userData.armL = armL;
  g.userData.armR = armR;
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

export function tintDiver(diver: Group, suitLevel: number, finLevel: number): void {
  const suit = diver.userData.suit as MeshLambertMaterial;
  suit.color.set(SUITS[Math.max(0, Math.min(3, suitLevel))]);
  const stretch = 1 + finLevel * 0.18;
  for (const fin of diver.userData.fins as Mesh[]) {
    fin.scale.set(0.16 + finLevel * 0.02, 0.035, 0.34 * stretch);
  }
}

export function animateDiver(diver: Group, time: number, swim: number, burst: boolean): void {
  const moving = swim > 0.25;
  const rate = moving ? (burst ? 13 : 8) : 2;
  const amp = moving ? 0.65 : 0.08;
  const s = Math.sin(time * rate);
  (diver.userData.legL as Group).rotation.x = s * amp;
  (diver.userData.legR as Group).rotation.x = -s * amp;
  (diver.userData.armL as Group).rotation.x = -s * amp * 0.55;
  (diver.userData.armR as Group).rotation.x = s * amp * 0.55;
  diver.rotation.z = s * (moving ? 0.05 : 0.015);
}

export function animateTail(group: Group, time: number, speed: number, phase = 0): void {
  const tail = group.userData.tail as Group | undefined;
  if (tail) tail.rotation.y = Math.sin(time * speed + phase) * 0.45;
  const wingL = group.userData.wingL as Group | undefined;
  const wingR = group.userData.wingR as Group | undefined;
  if (wingL && wingR) {
    const w = Math.sin(time * 1.6 + phase) * 0.22;
    wingL.rotation.z = w;
    wingR.rotation.z = -w;
  }
  const flipL = group.userData.flipL as Group | undefined;
  const flipR = group.userData.flipR as Group | undefined;
  if (flipL && flipR) {
    const w = Math.sin(time * 2.2 + phase) * 0.5;
    flipL.rotation.z = 0.4 + w;
    flipR.rotation.z = -0.4 - w;
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
