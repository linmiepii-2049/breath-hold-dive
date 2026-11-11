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
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
} from 'three';
import { mergeParts, M, UNIT } from './models';
import { terrainHeight } from './terrain';
import { rng } from './util';

export const LANDMARKS = {
  anemone: { x: 7.2, z: 17.5 },
  octopus: { x: -8.4, z: 26 },
  bait: { x: 1.5, z: 32 },
};

export interface Solid {
  x: number;
  y: number;
  z: number;
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
  update(time: number, camY: number, diverDepth: number): void;
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
  reef.userData.occluder = true;
  wall.userData.occluder = true;
  scene.add(reef);
  scene.add(wall);
  scene.add(buildBeach());

  const anemone = buildAnemone();
  anemone.position.set(LANDMARKS.anemone.x, terrainHeight(LANDMARKS.anemone.x, LANDMARKS.anemone.z), LANDMARKS.anemone.z);
  scene.add(anemone);

  const kelp = buildKelp();
  const fans = buildFans();
  kelp.forEach((m) => scene.add(m));
  fans.forEach((m) => scene.add(m));

  const shafts = buildShafts();
  shafts.forEach((m) => scene.add(m));

  const shallow = new Color('#178f9c');
  const deep = new Color('#07131e');
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
    update(time, camY, diverDepth) {
      const diveT = Math.min(1, diverDepth / 34);
      const under = Math.min(1, Math.max(0, (0.4 - camY) / 4));
      const waterMix = Math.max(under, diveT * 0.85);
      fog.color.copy(air).lerp(shallow, Math.min(1, waterMix * 1.35)).lerp(deep, diveT);
      fog.density = 0.008 + waterMix * 0.012 + diveT * 0.042;
      hemi.intensity = 0.95 - diveT * 0.62;
      sun.intensity = 1.4 - diveT * 1.05;
      const mat = floor.material as ShaderMaterial;
      mat.uniforms.uTime.value = time;
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
      shafts.forEach((m, i) => {
        const fade = (1 - Math.min(1, diverDepth / 14)) * (camY < 8 ? 1 : 0.45);
        (m.material as MeshBasicMaterial).opacity = 0.16 * fade;
        m.rotation.y = Math.sin(time * 0.25 + i) * 0.15;
        m.position.x = (m.userData.baseX as number) + Math.sin(time * 0.3 + i) * 0.4;
      });
    },
  };
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
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 } }]),
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
      #include <fog_pars_fragment>
      void main() {
        float flatN = clamp(vNormalW.y, 0.0, 1.0);
        vec3 sand = vec3(0.78, 0.68, 0.46);
        vec3 rock = vec3(0.33, 0.46, 0.49);
        vec3 base = mix(rock, sand, smoothstep(0.58, 0.92, flatN));
        float deepT = clamp((-vWorld.y - 6.0) / 30.0, 0.0, 1.0);
        deepT = deepT * deepT * (3.0 - 2.0 * deepT);
        base = mix(base, vec3(0.06, 0.13, 0.18), deepT);
        float n1 = sin(vWorld.x * 0.45 + uTime * 0.85) * sin(vWorld.z * 0.38 - uTime * 0.65);
        float n2 = sin(vWorld.x * 0.2 - uTime * 0.4 + vWorld.z * 0.17);
        float ca = smoothstep(0.4, 1.3, n1 + n2);
        float shallow = 1.0 - clamp((-vWorld.y - 5.0) / 14.0, 0.0, 1.0);
        ca *= shallow * flatN;
        vec3 sunDir = normalize(vec3(-0.28, 0.92, 0.25));
        float lam = clamp(dot(normalize(vNormalW), sunDir), 0.0, 1.0);
        vec3 col = base * (0.34 + 0.8 * lam) + vec3(0.55, 0.75, 0.68) * ca * 1.15;
        col *= mix(1.0, 0.5, deepT);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
  return new Mesh(geo, mat);
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
  const rockColor = new Color(0x5d7278);
  for (const spot of [LANDMARKS.octopus, LANDMARKS.anemone]) {
    const floor = terrainHeight(spot.x, spot.z);
    for (let k = 0; k < 4; k++) {
      const ang = k * 1.6;
      const px = spot.x + Math.cos(ang) * 1.1;
      const py = floor + 0.45;
      const pz = spot.z + Math.sin(ang) * 1.1;
      const rx = rand();
      const ry = rand() * 3;
      const rz = rand();
      const sx = 0.7 + rand() * 0.5;
      parts.push({
        geo: UNIT.ico,
        matrix: M(px, py, pz, rx, ry, rz, sx, 0.55, 0.7),
        color: rockColor,
      });
      // Unit icosahedron has radius 1, so the mesh reaches the largest scale.
      solids.push({ x: px, y: py, z: pz, r: Math.max(sx, 0.55, 0.7) + 0.75 });
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = -28 + rand() * 52;
    const z = 6 + rand() * 60;
    const floor = terrainHeight(x, z);
    if (floor > -3) continue;
    const s = 0.4 + rand() * 1.1;
    const py = floor + s * 0.35;
    parts.push({
      geo: UNIT.ico,
      matrix: M(x, py, z, rand(), rand() * 4, rand() * 0.4, s, s * 0.7, s),
      color: new Color(0x4e656c).offsetHSL(0, 0, (rand() - 0.5) * 0.06),
    });
    if (s >= 0.72) solids.push({ x, y: py, z, r: s + 0.75 });
  }
  const geo = mergeParts(parts);
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geo, mat);
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
    parts.push({
      geo: UNIT.ico,
      matrix: M(x, py, z, rand(), rand() * 3, rand(), s, h, s * 0.8),
      color: new Color(0x3e5560).offsetHSL(0, 0, (rand() - 0.5) * 0.05),
    });
    // The mesh is s wide and 2h tall. One undersized sphere left the torso in the rock.
    const r = Math.max(s, s * 0.8) + 0.75;
    const bottom = py - h + r;
    const top = py + h - r;
    const step = Math.max(0.9, r * 0.85);
    let placed = false;
    for (let y = bottom; y <= top + 0.01; y += step) {
      solids.push({ x, y: Math.max(floor + r * 0.45, y), z, r });
      placed = true;
    }
    if (!placed) solids.push({ x, y: Math.max(floor + r * 0.45, py), z, r });
  }
  const geo = mergeParts(parts);
  return new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
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
