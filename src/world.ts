import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  Euler,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  Vector3,
  UniformsUtils,
} from 'three';
import { mergeParts, M, UNIT } from './models';
import { terrainHeight } from './terrain';
import { rng } from './util';

export const LANDMARKS = {
  anemone: { x: -3, z: 17.2 },
  octopus: { x: -8.4, z: 26 },
  bait: { x: 1.5, z: 32 },
};

/** Oriented box that contains the rock mesh. `r` is the half-diagonal, for a broadphase. */
export interface Solid {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  r: number;
}

export interface World {
  scene: Scene;
  fog: FogExp2;
  water: Mesh;
  shafts: Mesh[];
  anemone: Group;
  kelp: Mesh[];
  fans: Mesh[];
  snell: Mesh;
  hemi: import('three').HemisphereLight;
  sun: import('three').DirectionalLight;
  solids: Solid[];
  update(time: number, camY: number, diverDepth: number, diverX?: number, diverY?: number, diverZ?: number, camX?: number, camZ?: number, view?: PerspectiveCamera | null, lookX?: number, lookY?: number, lookZ?: number): void;
  /** Full detail draws light shafts. The low tier hides them and eases the fog. */
  setDetail(full: boolean): void;
}

export function createWorld(): World {
  const scene = new Scene();
  const fogColor = new Color('#b7e0ec');
  const fog = new FogExp2(fogColor, 0.012);
  scene.fog = fog;
  scene.background = fog.color;

  const hemi = new HemisphereLight(0xd8fff6, 0x1a4a44, 0.95);
  scene.add(hemi);
  const sun = new DirectionalLight(0xfff3d6, 1.35);
  sun.position.set(-30, 50, 10);
  scene.add(sun);

  const floor = buildFloor();
  scene.add(floor);

  const waterMat = new MeshPhongMaterial({
    color: 0x1a8ea0,
    transparent: true,
    opacity: 0.34,
    shininess: 120,
    specular: new Color(0xbff7ff),
    side: DoubleSide,
    depthWrite: false,
    emissive: new Color(0x062f38),
    emissiveIntensity: 0.4,
  });
  const water = new Mesh(new PlaneGeometry(200, 180), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, 30);
  scene.add(water);

  const sky = new Mesh(
    new SphereGeometry(220, 16, 10),
    new MeshBasicMaterial({ color: 0x9fd4ea, side: BackSide }),
  );
  scene.add(sky);

  const snell = new Mesh(
    new CircleGeometry(18, 24),
    new MeshBasicMaterial({
      color: 0xe9fdff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
    }),
  );
  snell.rotation.x = Math.PI / 2;
  snell.position.y = -0.15;
  scene.add(snell);

  const solids: Solid[] = [];
  const reef = buildReef(solids);
  const wall = buildWall(solids);
  const laneRocks = buildLaneRocks(solids);
  reef.userData.occluder = true;
  wall.userData.occluder = true;
  laneRocks.userData.occluder = true;
  scene.add(reef);
  scene.add(wall);
  scene.add(laneRocks);
  scene.add(buildFloorCoral(solids));
  scene.add(buildBeach());
  const guideFades: Mesh[] = [];
  scene.add(buildTrenchGuide(guideFades));

  const anemone = buildAnemone();
  anemone.position.set(LANDMARKS.anemone.x, terrainHeight(LANDMARKS.anemone.x, LANDMARKS.anemone.z), LANDMARKS.anemone.z);
  scene.add(anemone);

  const kelp = buildKelp();
  const fans = buildFans();
  kelp.forEach((m) => scene.add(m));
  fans.forEach((m) => scene.add(m));

  const shafts = buildShafts();
  shafts.forEach((m) => scene.add(m));
  let detail = true;

  const shallow = new Color('#178f9c');
  const deep = new Color('#143246');
  const air = new Color('#b7e0ec');

  return {
    scene,
    fog,
    water,
    shafts,
    anemone,
    kelp,
    fans,
    snell,
    hemi,
    sun,
    solids,
    update(time, camY, diverDepth, diverX = 0, diverY = -diverDepth, diverZ = 0, _camX = diverX, _camZ = diverZ, view = null, lookX = 0, lookY = 0, lookZ = 1) {
      const diveT = Math.min(1, diverDepth / 42);
      const under = Math.min(1, Math.max(0, (0.4 - camY) / 4));
      const waterMix = Math.max(under, diveT * 0.85);
      // Distance falls toward deep blue. Near the floor the haze stays lighter so a rock
      // within about 8 m and the beads on the lane still read.
      fog.color.copy(air).lerp(shallow, Math.min(1, waterMix * 1.05)).lerp(deep, 0.1 + diveT * 0.28);
      const haze = 0.0012 + waterMix * 0.0008 + diveT * 0.0018;
      fog.density = detail ? haze : haze * 0.72;
      hemi.intensity = 1.4 - diveT * 0.12;
      sun.intensity = 1.6 - diveT * 0.18;
      const floorMat = floor.material as ShaderMaterial;
      floorMat.uniforms.uNear.value.set(diverX, diverY, diverZ);
      floorMat.uniforms.uTime.value = time;
      waterMat.opacity = camY > 0.4 ? 0.3 : 0.55;
      snell.visible = camY < 0.2;

      anemone.children.forEach((child, i) => {
        child.rotation.x = Math.sin(time * 1.4 + i) * 0.28;
        child.rotation.z = Math.cos(time * 1.1 + i * 0.7) * 0.28;
      });
      kelp.forEach((m, i) => {
        m.rotation.z = Math.sin(time * 0.8 + i) * 0.12;
        m.rotation.y = m.userData.baseY as number;
      });
      fans.forEach((m, i) => {
        m.rotation.y = (m.userData.baseY as number) + Math.sin(time * 0.6 + i) * 0.08;
      });
      // Links inside 4 m of the body are not drawn. Anything that still lands on
      // the suit in screen space (a foreshortened segment, or a bead) is hidden too.
      // Beads and links that sit clear of the diver stay visible.
      const finder = !!view && view.near < 0.1;
      if (view) refreshBodyScreen(view, diverX, diverY, diverZ, lookX, lookY, lookZ);
      else bodyReady = false;
      for (let i = 0; i < guideFades.length; i++) {
        const mesh = guideFades[i];
        const seg = mesh.userData.seg as GuideSeg;
        const mat = mesh.material as MeshBasicMaterial;
        const link = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay, seg.bz - seg.az) > 0.05;
        let hide = finder;
        if (!hide && link) {
          const near = Math.min(
            distToSeg(diverX, diverY, diverZ, seg),
            distToSeg(diverX - lookX * 1.15, diverY - lookY * 1.15, diverZ - lookZ * 1.15, seg),
            distToSeg(diverX + lookX * 0.65, diverY + lookY * 0.65, diverZ + lookZ * 0.65, seg),
          );
          hide = near < 4 || segmentOnDiver(view, seg);
        } else if (!hide) {
          hide = pointOnDiver(view, seg.ax, seg.ay, seg.az, 0.32);
        }
        mat.opacity = hide ? 0 : (mesh.userData.baseOpacity as number);
        mesh.visible = !hide;
      }
      if (detail) {
        shafts.forEach((m, i) => {
          const fade = (1 - Math.min(1, diverDepth / 14)) * (camY < 8 ? 1 : 0.45);
          (m.material as MeshBasicMaterial).opacity = 0.16 * fade;
          m.rotation.y = Math.sin(time * 0.25 + i) * 0.15;
          m.position.x = (m.userData.baseX as number) + Math.sin(time * 0.3 + i) * 0.4;
        });
      }
    },
    setDetail(full: boolean) {
      detail = full;
      shafts.forEach((m) => {
        m.visible = full;
      });
      kelp.forEach((m, i) => {
        m.visible = full || i % 3 === 0;
      });
      fans.forEach((m, i) => {
        m.visible = full || i % 2 === 0;
      });
    },
  };
}

const guideUp = new Vector3(0, 1, 0);
const guideDir = new Vector3();
const screenA = new Vector3();
const screenFwd = new Vector3();

/** Screen box of the suit, shoulders, and fin blades. Refreshed once a frame. */
let bodyReady = false;
let bodyMinX = 2;
let bodyMaxX = -2;
let bodyMinY = 2;
let bodyMaxY = -2;
let bodyTan = 0.4;
let bodyAspect = 1;

/** Local diver points: +Y head, +X right, +Z belly. Includes the fin blades. */
const BODY_SCREEN: Array<[number, number, number]> = [
  [0, 1.72, 0],
  [0.38, 1.3, 0],
  [-0.38, 1.3, 0],
  [0, 1.18, 0.24],
  [0, 1.18, -0.24],
  [0, 0.82, 0],
  [0.22, 0.16, 0.52],
  [-0.22, 0.16, 0.52],
  [0.22, 0.14, -0.55],
  [-0.22, 0.14, -0.55],
  [0.58, 0.14, -0.06],
  [-0.58, 0.14, -0.06],
];

function refreshBodyScreen(
  cam: PerspectiveCamera,
  diverX: number,
  diverY: number,
  diverZ: number,
  lookX: number,
  lookY: number,
  lookZ: number,
): void {
  bodyReady = false;
  bodyMinX = 2;
  bodyMaxX = -2;
  bodyMinY = 2;
  bodyMaxY = -2;
  cam.updateMatrixWorld();
  cam.getWorldDirection(screenFwd);
  bodyTan = Math.tan((cam.fov * Math.PI) / 360) || 0.4;
  bodyAspect = Math.max(0.3, cam.aspect);
  const flat = Math.hypot(lookX, lookZ) || 1;
  const rx = lookZ / flat;
  const rz = -lookX / flat;
  const bxx = -rz * lookY;
  const byy = rz * lookX - rx * lookZ;
  const bzz = rx * lookY;
  const ox = diverX - lookX * 0.55;
  const oy = diverY - 0.58 - lookY * 0.55;
  const oz = diverZ - lookZ * 0.55;
  let near = 99;
  for (let i = 0; i < BODY_SCREEN.length; i++) {
    const p = BODY_SCREEN[i];
    const px = ox + rx * p[0] + lookX * p[1] + bxx * p[2];
    const py = oy + lookY * p[1] + byy * p[2];
    const pz = oz + rz * p[0] + lookZ * p[1] + bzz * p[2];
    const fx = px - cam.position.x;
    const fy = py - cam.position.y;
    const fz = pz - cam.position.z;
    if (fx * screenFwd.x + fy * screenFwd.y + fz * screenFwd.z < 0.2) continue;
    screenA.set(px, py, pz).project(cam);
    if (screenA.z < -1 || screenA.z > 1) continue;
    bodyMinX = Math.min(bodyMinX, screenA.x);
    bodyMaxX = Math.max(bodyMaxX, screenA.x);
    bodyMinY = Math.min(bodyMinY, screenA.y);
    bodyMaxY = Math.max(bodyMaxY, screenA.y);
    near = Math.min(near, Math.hypot(fx, fy, fz));
  }
  if (bodyMaxX < bodyMinX) return;
  const dist = Math.max(0.6, near);
  // The samples are joint centres. The suit and the fin blades extend about half a metre past them.
  const padY = 0.7 / (dist * bodyTan);
  const padX = padY / bodyAspect;
  bodyMinX -= padX;
  bodyMaxX += padX;
  bodyMinY -= padY;
  bodyMaxY += padY;
  bodyReady = true;
}

/** True when a world point, expanded by `radius` metres, lands on the suit. */
function pointOnDiver(cam: PerspectiveCamera | null, x: number, y: number, z: number, radius: number): boolean {
  if (!cam || !bodyReady) return false;
  const bx = x - cam.position.x;
  const by = y - cam.position.y;
  const bz = z - cam.position.z;
  if (bx * screenFwd.x + by * screenFwd.y + bz * screenFwd.z < 0.2) return false;
  screenA.set(x, y, z).project(cam);
  if (screenA.z < -1 || screenA.z > 1) return false;
  const dist = Math.max(0.4, Math.hypot(bx, by, bz));
  const padY = radius / (dist * bodyTan);
  const padX = padY / bodyAspect;
  return (
    screenA.x + padX >= bodyMinX &&
    screenA.x - padX <= bodyMaxX &&
    screenA.y + padY >= bodyMinY &&
    screenA.y - padY <= bodyMaxY
  );
}

function segmentOnDiver(cam: PerspectiveCamera | null, seg: GuideSeg): boolean {
  if (!cam || !bodyReady) return false;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    if (pointOnDiver(cam, seg.ax + (seg.bx - seg.ax) * t, seg.ay + (seg.by - seg.ay) * t, seg.az + (seg.bz - seg.az) * t, 0.08)) return true;
  }
  return false;
}

interface GuideSeg {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
}

function guideMaterial(color: number, opacity = 1): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({
    color,
    fog: false,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return mat;
}

function distToSeg(px: number, py: number, pz: number, seg: GuideSeg): number {
  const abx = seg.bx - seg.ax;
  const aby = seg.by - seg.ay;
  const abz = seg.bz - seg.az;
  const ab2 = abx * abx + aby * aby + abz * abz || 1e-6;
  let t = ((px - seg.ax) * abx + (py - seg.ay) * aby + (pz - seg.az) * abz) / ab2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (seg.ax + abx * t), py - (seg.ay + aby * t), pz - (seg.az + abz * t));
}

function tagSeg(mesh: Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, opacity: number): void {
  mesh.userData.seg = { ax, ay, az, bx, by, bz };
  mesh.userData.baseOpacity = opacity;
}

/** Bead x at this z. On the default heading, shifted right so the line sits beside the diver, not through the body. */
function beadX(z: number): number {
  return 6.2 + Math.max(0, z - 9) * Math.tan(0.15) + 1.7;
}

/** Glide height: in the water the diver actually swims, never under the floor. */
function beadHeight(x: number, z: number): number {
  const floor = terrainHeight(x, z);
  // Steeper than the old glide, so a pitched-down diver still has the next beads
  // ahead and below, not floating above the follow frame.
  const glide = -4.0 - Math.max(0, z - 11) * 0.9;
  if (glide < floor + 1.35) return floor + 1.05;
  return Math.max(floor + 1.7, glide);
}

function guideBead(g: Group, fades: Mesh[], x: number, z: number, color: number, radius: number, y: number): Vector3 {
  const m = new Mesh(new SphereGeometry(radius, 12, 10), guideMaterial(color));
  m.position.set(x, y, z);
  tagSeg(m, x, y, z, x, y, z, 1);
  g.add(m);
  fades.push(m);
  return m.position.clone();
}

function guideLink(g: Group, fades: Mesh[], a: Vector3, b: Vector3, color: number, radius: number): void {
  guideDir.copy(b).sub(a);
  const len = guideDir.length();
  if (len < 0.05) return;
  const steps = Math.max(1, Math.ceil(len / 0.65));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const pa = a.clone().lerp(b, t0);
    const pb = a.clone().lerp(b, t1);
    const dir = pb.clone().sub(pa);
    const piece = dir.length();
    if (piece < 0.02) continue;
    const mesh = new Mesh(new CylinderGeometry(radius, radius, piece, 5), guideMaterial(color));
    mesh.position.copy(pa).lerp(pb, 0.5);
    mesh.quaternion.setFromUnitVectors(guideUp, dir.multiplyScalar(1 / piece));
    tagSeg(mesh, pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, 1);
    g.add(mesh);
    fades.push(mesh);
  }
}

/** Gold beads and a connecting trail down the offshore lane, plus an orange branch to the anemone. */
function buildTrenchGuide(fades: Mesh[]): Group {
  const g = new Group();
  const gold = 0xffc24a;
  const orange = 0xff5a18;
  let prev: Vector3 | null = null;
  for (let z = 14; z <= 84; z += 2.5) {
    const x = beadX(z);
    const p = guideBead(g, fades, x, z, gold, 0.26, beadHeight(x, z));
    if (prev) guideLink(g, fades, prev, p, gold, 0.045);
    prev = p;
  }
  // Orange beads start a few metres ahead on the default look, then bend left to the anemone.
  // No vertical pole: that line was landing in the viewfinder and in photos.
  const lookX = Math.sin(0.15);
  const lookZ = Math.cos(0.15);
  const sx = 6.2 + lookX * 4.8 + 1.5;
  const sz = 9 + lookZ * 4.8;
  const ax = LANDMARKS.anemone.x;
  const az = LANDMARKS.anemone.z;
  const yStart = -2.15;
  const yEnd = terrainHeight(ax, az) + 1.7;
  let op: Vector3 | null = null;
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const bend = Math.sin(k * Math.PI) * 1.4;
    const x = sx + (ax - sx) * k - lookZ * bend;
    const z = sz + (az - sz) * k + lookX * bend;
    const y = yStart + (yEnd - yStart) * k;
    const p = guideBead(g, fades, x, z, orange, 0.34, y);
    if (op) guideLink(g, fades, op, p, orange, 0.04);
    op = p;
  }
  return g;
}

/** Loose rocks stay off the bead line and the clownfish and turtle photo spots. */
function onClearRoute(x: number, z: number): boolean {
  if (z > 10 && z < 74 && Math.abs(x - beadX(z)) < 2.8) return true;
  if (Math.hypot(x + 3, z - 17.2) < 3.2) return true;
  const turtles: Array<[number, number]> = [
    [-6, 20],
    [10, 24],
    [14, 36],
    [-4, 38],
  ];
  for (const [tx, tz] of turtles) {
    if (Math.hypot(x - tx, z - tz) < 2.4) return true;
  }
  return false;
}

function buildFloor(): Mesh {
  const geo = new PlaneGeometry(170, 150, 80, 70);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) + 28;
    pos.setZ(i, z);
    pos.setY(i, terrainHeight(x, z));
  }
  geo.computeVertexNormals();
  const mat = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uNear: { value: new Vector3() } }]),
    fog: true,
    vertexShader: `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      #include <fog_pars_vertex>
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorld = worldPosition.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      uniform float uTime;
      uniform vec3 uNear;
      #include <fog_pars_fragment>
      void main() {
        float flatN = clamp(vNormalW.y, 0.0, 1.0);
        vec3 sand = vec3(0.78, 0.68, 0.46);
        vec3 rock = vec3(0.33, 0.46, 0.49);
        vec3 base = mix(rock, sand, smoothstep(0.58, 0.92, flatN));
        float deepT = clamp((-vWorld.y - 8.0) / 36.0, 0.0, 1.0);
        deepT = deepT * deepT * (3.0 - 2.0 * deepT);
        base = mix(base, vec3(0.58, 0.74, 0.72), deepT * 0.22);
        float n1 = sin(vWorld.x * 0.45 + uTime * 0.85) * sin(vWorld.z * 0.38 - uTime * 0.65);
        float n2 = sin(vWorld.x * 0.2 - uTime * 0.4 + vWorld.z * 0.17);
        float ca = smoothstep(0.4, 1.3, n1 + n2);
        float shallow = 1.0 - clamp((-vWorld.y - 6.0) / 28.0, 0.0, 1.0);
        ca *= shallow * flatN;
        vec3 sunDir = normalize(vec3(-0.28, 0.92, 0.25));
        float lam = clamp(dot(normalize(vNormalW), sunDir), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(normalize(vNormalW), sunDir), 0.0, 1.0), 1.4);
        vec3 col = base * (0.72 + 0.55 * lam) + vec3(0.62, 0.84, 0.76) * ca * 1.2;
        col += vec3(0.22, 0.34, 0.32) * rim * (1.0 - deepT * 0.12);
        col *= mix(1.0, 1.02, deepT);
        float nearD = distance(vWorld, uNear);
        float nearK = 1.0 - smoothstep(1.5, 14.0, nearD);
        // The sand within about 14 m of the diver stays a light tan at the floor.
        float grain = sin(vWorld.x * 1.6 + vWorld.z * 0.4) * sin(vWorld.z * 1.35);
        vec3 deepSand = vec3(0.58, 0.74, 0.68) * (1.05 + 0.32 * lam) + vec3(0.03, 0.04, 0.03) * grain;
        col = mix(col, mix(col * 0.88, deepSand, nearK), deepT * 0.72);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
  return new Mesh(geo, mat);
}

const boxEuler = new Euler();
const boxQuat = new Quaternion();
const boxX = new Vector3();
const boxY = new Vector3();
const boxZ = new Vector3();

/**
 * The icosahedron sits inside the unit cube. Scaled and rotated, that cube is an
 * oriented box that contains the mesh, including a ledge or a tall wall.
 */
function pushRock(
  solids: Solid[],
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  boxEuler.set(rx, ry, rz);
  boxQuat.setFromEuler(boxEuler);
  boxX.set(1, 0, 0).applyQuaternion(boxQuat);
  boxY.set(0, 1, 0).applyQuaternion(boxQuat);
  boxZ.set(0, 0, 1).applyQuaternion(boxQuat);
  const skin = 0.32;
  const hx = Math.abs(sx) + skin;
  const hy = Math.abs(sy) + skin;
  const hz = Math.abs(sz) + skin;
  solids.push({
    x,
    y,
    z,
    hx,
    hy,
    hz,
    ax: boxX.x,
    ay: boxX.y,
    az: boxX.z,
    bx: boxY.x,
    by: boxY.y,
    bz: boxY.z,
    cx: boxZ.x,
    cy: boxZ.y,
    cz: boxZ.z,
    r: Math.hypot(hx, hy, hz),
  });
}

function buildReef(solids: Solid[]): Mesh {
  const rand = rng(2049);
  const parts: { geo: BufferGeometry; matrix: Matrix4; color: Color }[] = [];
  const colors = [0xe38b9b, 0xe07a3d, 0x8d6b9c, 0xd2c06a, 0xde6d58].map((c) => new Color(c));
  for (let i = 0; i < 34; i++) {
    const x = -26 + rand() * 48;
    const z = 8 + rand() * 40;
    const floor = terrainHeight(x, z);
    if (floor < -16 || floor > -3) continue;
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const h = 0.5 + rand() * 1.5;
      const r = 0.12 + rand() * 0.22;
      const dx = (rand() - 0.5) * 1.4;
      const dz = (rand() - 0.5) * 1.4;
      const tilt = (rand() - 0.5) * 0.5;
      const geo = rand() > 0.35 ? UNIT.cone : UNIT.cyl;
      parts.push({
        geo,
        matrix: M(x + dx, floor + h * 0.45, z + dz, tilt, rand() * 6, tilt * 0.5, r, h, r),
        color: colors[Math.floor(rand() * colors.length)],
      });
    }
  }
  // Landmark rocks so the octopus crevice and anemone read clearly.
  // The anemone's open side faces the spawn, so a level shot is not a rock.
  const rockColor = new Color(0x8eafb6);
  for (const spot of [LANDMARKS.octopus, LANDMARKS.anemone]) {
    const floor = terrainHeight(spot.x, spot.z);
    const anemone = spot === LANDMARKS.anemone;
    const count = anemone ? 3 : 4;
    for (let k = 0; k < count; k++) {
      const ang = anemone ? Math.PI * 0.85 + k * 0.7 : k * 1.6;
      const ring = anemone ? 2.1 : 1.1;
      const px = spot.x + Math.cos(ang) * ring;
      const py = floor + 0.45;
      const pz = spot.z + Math.sin(ang) * ring;
      const rx = rand();
      const ry = rand() * 3;
      const rz = rand();
      const sx = 0.7 + rand() * 0.5;
      parts.push({
        geo: UNIT.ico,
        matrix: M(px, py, pz, rx, ry, rz, sx, 0.55, 0.7),
        color: rockColor,
      });
      pushRock(solids, px, py, pz, rx, ry, rz, sx, 0.55, 0.7);
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = -28 + rand() * 52;
    const z = 6 + rand() * 60;
    const floor = terrainHeight(x, z);
    if (floor > -3) continue;
    const s = 0.4 + rand() * 1.1;
    const py = floor + s * 0.35;
    const rx = rand();
    const ry = rand() * 4;
    const rz = rand() * 0.4;
    if (onClearRoute(x, z)) continue;
    parts.push({
      geo: UNIT.ico,
      matrix: M(x, py, z, rx, ry, rz, s, s * 0.7, s),
      color: new Color(0x4e656c).offsetHSL(0, 0, (rand() - 0.5) * 0.06),
    });
    pushRock(solids, x, py, z, rx, ry, rz, s, s * 0.7, s);
  }
  const geo = mergeParts(parts);
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    emissive: 0x163038,
    emissiveIntensity: 0.7,
  });
  return new Mesh(geo, mat);
}

/** Stones just off the default heading, at the 34 m and 41 m water, so a straight descent has a rock in view. */
function buildLaneRocks(solids: Solid[]): Mesh {
  const parts: { geo: BufferGeometry; matrix: Matrix4; color: Color }[] = [];
  const color = new Color(0xd5eef2);
  const place = (x: number, z: number, s: number, rx: number, ry: number, rz: number) => {
    const floor = terrainHeight(x, z);
    const py = floor + s * 0.42;
    parts.push({
      geo: UNIT.ico,
      matrix: M(x, py, z, rx, ry, rz, s, s * 0.8, s * 1.05),
      color,
    });
    pushRock(solids, x, py, z, rx, ry, rz, s, s * 0.8, s * 1.05);
  };
  for (const z of [48, 56, 66, 74]) place(beadX(z) + 4.4, z, 1.45, 0.35, 1.1, 0.25);
  // Closer to the swim line on the 41 m floor, so a downward look has a rock within ~8 m.
  const heading = (z: number) => 6.2 + Math.max(0, z - 9) * Math.tan(0.15);
  place(heading(58) - 2.6, 58, 1.2, 0.4, 0.6, 0.2);
  place(heading(64) + 3.4, 64, 1.35, 0.2, 1.4, 0.35);
  place(heading(70) - 2.2, 70, 1.25, 0.5, 0.8, 0.15);
  place(heading(76) + 3.1, 76, 1.15, 0.25, 1.8, 0.3);
  return new Mesh(
    mergeParts(parts),
    new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      emissive: 0x3a8490,
      emissiveIntensity: 1.55,
    }),
  );
}

/** A few low-poly coral heads on the 41 m lane, so the floor is not only sand and one dark stone. */
function buildFloorCoral(solids: Solid[]): Group {
  const g = new Group();
  const teal = new MeshLambertMaterial({ color: 0x3ed0be, emissive: 0x146860, emissiveIntensity: 0.95, flatShading: true });
  const rose = new MeshLambertMaterial({ color: 0xe8889c, emissive: 0x8a3850, emissiveIntensity: 0.75, flatShading: true });
  const spots = [
    { z: 61, side: -1.4, h: 0.85, mat: rose },
    { z: 67, side: 2.2, h: 1.05, mat: teal },
    { z: 73, side: -1.8, h: 0.75, mat: teal },
  ];
  for (const s of spots) {
    const x = 6.2 + Math.max(0, s.z - 9) * Math.tan(0.15) + s.side;
    const floor = terrainHeight(x, s.z);
    const a = new Mesh(UNIT.cone, s.mat);
    a.scale.set(0.32, s.h, 0.32);
    a.position.set(x, floor + s.h * 0.45, s.z);
    pushRock(solids, x, floor + s.h * 0.45, s.z, 0, 0, 0, 0.32, s.h * 0.5, 0.32);
    const b = new Mesh(UNIT.cone, s.mat === teal ? rose : teal);
    b.scale.set(0.2, s.h * 0.65, 0.2);
    b.position.set(x + 0.38, floor + s.h * 0.28, s.z + 0.22);
    pushRock(solids, x + 0.38, floor + s.h * 0.28, s.z + 0.22, 0, 0, 0, 0.2, s.h * 0.32, 0.2);
    g.add(a, b);
  }
  return g;
}

function buildWall(solids: Solid[]): Mesh {
  const rand = rng(77);
  const parts: { geo: BufferGeometry; matrix: Matrix4; color: Color }[] = [];
  for (let i = 0; i < 42; i++) {
    const z = 16 + rand() * 60;
    const x = 30 + rand() * 8;
    const floor = terrainHeight(Math.min(x, 27), z);
    const h = 3 + rand() * 8;
    const s = 1.4 + rand() * 2.2;
    const py = floor + h * 0.35;
    const rx = rand();
    const ry = rand() * 3;
    const rz = rand();
    parts.push({
      geo: UNIT.ico,
      matrix: M(x, py, z, rx, ry, rz, s, h, s * 0.8),
      color: new Color(0x3e5560).offsetHSL(0, 0, (rand() - 0.5) * 0.05),
    });
    // Same orientation as the mesh. A stack of spheres along world Y missed a tilted wall.
    pushRock(solids, x, py, z, rx, ry, rz, s, h, s * 0.8);
  }
  const geo = mergeParts(parts);
  return new Mesh(
    geo,
    new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      emissive: 0x163038,
      emissiveIntensity: 0.7,
    }),
  );
}

function buildBeach(): Group {
  const g = new Group();
  const wood = new MeshLambertMaterial({ color: 0x8d6242, flatShading: true });
  const deck = new Mesh(UNIT.box, wood);
  deck.scale.set(2.4, 0.16, 7);
  deck.position.set(1.2, 0.55, -2);
  g.add(deck);
  for (const [x, z] of [
    [0.2, 0.6],
    [2.2, 0.6],
    [0.2, -4.6],
    [2.2, -4.6],
  ] as const) {
    const post = new Mesh(new CylinderGeometry(0.1, 0.12, 1.6, 5), wood);
    post.position.set(x, 0.1, z);
    g.add(post);
  }
  const trunkMat = new MeshLambertMaterial({ color: 0x6b4a32, flatShading: true });
  const leafMat = new MeshLambertMaterial({ color: 0x2f8f4e, flatShading: true });
  for (const [x, z] of [
    [-6, -6],
    [8, -7.5],
  ] as const) {
    const trunk = new Mesh(new CylinderGeometry(0.18, 0.28, 3.2, 5), trunkMat);
    trunk.position.set(x, terrainHeight(x, z) + 1.5, z);
    trunk.rotation.z = x < 0 ? 0.12 : -0.1;
    g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const leaf = new Mesh(UNIT.cone, leafMat);
      leaf.scale.set(0.55, 1.4, 0.2);
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(x + Math.cos(a) * 0.7, terrainHeight(x, z) + 3.3, z + Math.sin(a) * 0.7);
      leaf.rotation.z = Math.cos(a) * 0.9;
      leaf.rotation.x = Math.sin(a) * 0.9;
      g.add(leaf);
    }
  }
  const buoy = new Mesh(new SphereGeometry(0.35, 8, 6), new MeshLambertMaterial({ color: 0xe24b3a, flatShading: true }));
  buoy.position.set(-5, 0.15, 9);
  g.add(buoy);
  const rope = new Mesh(new CylinderGeometry(0.03, 0.03, 1.2, 4), wood);
  rope.position.set(-5, -0.4, 9);
  g.add(rope);
  return g;
}

function buildAnemone(): Group {
  const g = new Group();
  const pink = new MeshLambertMaterial({ color: 0xd45b86, flatShading: true });
  const cream = new MeshLambertMaterial({ color: 0xf0c9a0, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const tentacle = new Mesh(new CylinderGeometry(0.07, 0.1, 1.3, 5), i % 2 ? pink : cream);
    tentacle.position.set(Math.cos(a) * 0.35, 0.65, Math.sin(a) * 0.35);
    g.add(tentacle);
  }
  return g;
}

function buildKelp(): Mesh[] {
  const mat = new MeshLambertMaterial({ color: 0x1f7a49, flatShading: true, side: DoubleSide });
  const list: Mesh[] = [];
  const rand = rng(12);
  for (let i = 0; i < 14; i++) {
    const x = -20 + rand() * 36;
    const z = 20 + rand() * 28;
    const floor = terrainHeight(x, z);
    if (floor < -18 || floor > -5) continue;
    const m = new Mesh(new PlaneGeometry(0.7, 3.6 + rand() * 2), mat);
    m.position.set(x, floor + 2.2, z);
    m.userData.baseY = rand() * Math.PI;
    m.userData.occluder = true;
    m.rotation.y = m.userData.baseY as number;
    list.push(m);
  }
  return list;
}

function buildFans(): Mesh[] {
  const mat = new MeshLambertMaterial({ color: 0xc46b7a, flatShading: true, side: DoubleSide });
  const list: Mesh[] = [];
  const rand = rng(90);
  for (let i = 0; i < 8; i++) {
    const z = 24 + rand() * 40;
    const x = 24 + rand() * 3;
    const floor = terrainHeight(x - 2, z);
    const m = new Mesh(new PlaneGeometry(1.6, 2.2), mat);
    m.position.set(x, floor + 1.6, z);
    m.userData.baseY = -0.6;
    m.userData.occluder = true;
    m.rotation.y = -0.6;
    list.push(m);
  }
  return list;
}

function buildShafts(): Mesh[] {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return [];
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 128);
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 32, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.5, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, 32, 128);
  const tex = new CanvasTexture(c);
  const list: Mesh[] = [];
  const spots: Array<[number, number]> = [
    [-4, 14],
    [8, 20],
    [2, 28],
    [14, 16],
    [-10, 24],
  ];
  for (const [x, z] of spots) {
    const mat = new MeshBasicMaterial({
      map: tex,
      color: 0xd8fff6,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const m = new Mesh(new PlaneGeometry(3.2, 14), mat);
    const floor = terrainHeight(x, z);
    m.position.set(x, floor + 7, z);
    m.userData.baseX = x;
    list.push(m);
  }
  return list;
}

export function moveSnell(snell: Mesh, x: number, z: number): void {
  snell.position.x = x;
  snell.position.z = z;
}
