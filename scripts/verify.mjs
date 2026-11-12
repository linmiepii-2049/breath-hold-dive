/**
 * Regression harness. Real input from the default spawn. Debug hooks are read-only
 * except __bhDebug.warn, which only arms the shark the game already has.
 *
 *   npm run verify
 *
 * Screenshots and report.json land in verify-out/. Exit 1 if any row fails.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173/breath-hold-dive/';
const OUT = resolve('verify-out');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome-stable';
mkdirSync(OUT, { recursive: true });

const rows = [];

function add(row) {
  rows.push(row);
  const mark = row.pass ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${row.id}  ${row.detail}`);
}

function chromeArgs() {
  return [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ];
}

async function browser() {
  return chromium.launch({
    headless: false,
    executablePath: CHROME,
    args: chromeArgs(),
  });
}

async function openPage(b, { width, height, touch = false, debug = false, low = false }) {
  const context = await b.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.removeItem('breath-hold-dive-v1'));
  const q = `${debug ? 'debug=1' : ''}${debug && low ? '&' : ''}${low ? 'quality=low' : ''}`;
  await page.goto(BASE + (q ? `?${q}` : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dive');
  return { context, page };
}

function lumaOf(file) {
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(file)}).convert('RGB')
w, h = im.size
px = im.load()
vals = []
for y in range(int(h * 0.08), int(h * 0.70)):
    for x in range(int(w * 0.08), int(w * 0.92), 3):
        r, g, b = px[x, y]
        vals.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
mean = sum(vals) / len(vals)
var = sum((v - mean) ** 2 for v in vals) / len(vals)
print(f'{mean:.2f} {var ** 0.5:.2f}')
`;
  const out = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr || 'luma failed');
  const [mean, std] = out.stdout.trim().split(/\s+/).map(Number);
  return { mean, std };
}

function cornerRed(file) {
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(file)}).convert('RGB')
w, h = im.size
px = im.load()
def avg(x0, y0, x1, y1):
    rs = gs = n = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            rs += r; gs += g; n += 1
    return rs / n, gs / n
c = []
s = 28
for x0, y0 in ((2, 2), (w - s - 2, 2), (2, h - s - 2), (w - s - 2, h - s - 2)):
    c.append(avg(x0, y0, x0 + s, y0 + s))
cr = sum(p[0] for p in c) / 4
cg = sum(p[1] for p in c) / 4
mr, mg = avg(w // 2 - 40, h // 2 - 40, w // 2 + 40, h // 2 + 40)
print(f'{cr:.1f} {cg:.1f} {mr:.1f} {mg:.1f}')
`;
  const out = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr || 'corner failed');
  const [cr, cg, mr, mg] = out.stdout.trim().split(/\s+/).map(Number);
  return { cr, cg, mr, mg, redder: cr - cg > mr - mg + 40 && cr > cg + 25 };
}

const SAMPLE = () => {
  const g = window.__bh;
  const cam = g.cam;
  cam.updateMatrixWorld(true);
  g.diver.updateMatrixWorld(true);
  const V = cam.position.constructor;
  const v = new V();
  const dx = cam.position.x - g.feet.x;
  const dy = cam.position.y - (g.feet.y + 0.65);
  const dz = cam.position.z - g.feet.z;
  const elev = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  let outside = 0;
  let minX = 2;
  let maxX = -2;
  let minY = 2;
  let maxY = -2;
  let boxed = 0;
  let lowY = 2;
  g.diver.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      v.applyMatrix4(o.matrixWorld).project(cam);
      const inn = v.z > 0 && v.z < 1 && Math.abs(v.x) <= 0.96 && v.y <= 0.96 && v.y >= -0.68;
      if (v.z > 0 && v.z < 1) lowY = Math.min(lowY, v.y);
      if (!inn) outside++;
      else {
        boxed++;
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  });
  const fx = Math.sin(g.viewYaw);
  const fz = Math.cos(g.viewYaw);
  const chestY = g.feet.y + 1;
  let beads = 0;
  let lineHits = 0;
  let near4 = 0;
  const hitsBox = (x, y) => boxed > 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
  g.scene.traverse((o) => {
    const seg = o.userData && o.userData.seg;
    if (!seg || !o.visible) return;
    const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay, seg.bz - seg.az);
    const link = len > 0.05;
    if (link) {
      const abx = seg.bx - seg.ax;
      const aby = seg.by - seg.ay;
      const abz = seg.bz - seg.az;
      const ab2 = abx * abx + aby * aby + abz * abz || 1e-6;
      let t = ((g.feet.x - seg.ax) * abx + (chestY - seg.ay) * aby + (g.feet.z - seg.az) * abz) / ab2;
      t = Math.max(0, Math.min(1, t));
      const near = Math.hypot(g.feet.x - (seg.ax + abx * t), chestY - (seg.ay + aby * t), g.feet.z - (seg.az + abz * t));
      if (near < 4) near4++;
    }
    let beadIn = false;
    let crossed = false;
    const steps = link ? 10 : 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = seg.ax + (seg.bx - seg.ax) * t;
      const y = seg.ay + (seg.by - seg.ay) * t;
      const z = seg.az + (seg.bz - seg.az) * t;
      v.set(x, y, z).project(cam);
      if (!(v.z > 0 && v.z < 1)) continue;
      if (hitsBox(v.x, v.y)) crossed = true;
      if (!link) {
        const ahead = (x - g.feet.x) * fx + (z - g.feet.z) * fz;
        if (ahead > 1.2 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.92) beadIn = true;
      }
    }
    if (crossed) lineHits++;
    if (beadIn) beads++;
  });
  return {
    depth: +Math.max(0, -(g.feet.y + 0.9)).toFixed(2),
    pitch: +((g.viewPitch * 180) / Math.PI).toFixed(1),
    elev: +elev.toFixed(1),
    outside,
    lowY: +lowY.toFixed(2),
    fit: window.__fit || null,
    beads,
    lineHits,
    near4,
    blackout: !!g.blackout,
    feetY: +g.feet.y.toFixed(2),
    t: +g.life.t.toFixed(2),
  };
};

async function lockAndPitch(page) {
  await page.click('#dive');
  await page.waitForTimeout(400);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(150);
  const state = { x: 640, y: 400 };
  const client = await page.context().newCDPSession(page);
  async function moveY(px) {
    const n = Math.max(1, Math.ceil(Math.abs(px) / 36));
    for (let i = 0; i < n; i++) {
      state.y += px / n;
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });
      await page.waitForTimeout(16);
    }
  }
  async function setPitch(deg) {
    const cur = await page.evaluate(() => window.__bh.viewPitch);
    const delta = (cur - (deg * Math.PI) / 180) / 0.00095;
    if (Math.abs(delta) > 8) await moveY(delta);
  }
  return { setPitch };
}

async function diveScenario(b, { pitch, low, tier }) {
  const { context, page } = await openPage(b, { width: 1280, height: 800, debug: true, low });
  const { setPitch } = await lockAndPitch(page);
  // -72° from the surface wedges in the bowl and then runs out of oxygen
  // before the floor. Cruise at -62° and hold the sample pitch at each mark.
  const travel = pitch <= -70 ? -62 : pitch;
  await setPitch(travel);
  await page.keyboard.down('Space');
  await page.keyboard.press('KeyF');
  const marks = [10, 23, 34, 41];
  const seen = new Set();
  let ref = null;
  const t0 = Date.now();
  let stallAt = 0;
  let stallDepth = 0;
  let maxDepth = 0;
  while (Date.now() - t0 < 140000 && seen.size < marks.length) {
    const d = await page.evaluate(() => Math.max(0, -(window.__bh.feet.y + 0.9)));
    if (d > maxDepth) maxDepth = d;
    const dead = await page.evaluate(() => window.__bh.blackout || window.__bh.lockSurface);
    if (dead) break;
    // A steep pose wedges in the bowl lip. Hold a shallower pitch until the shelf is behind.
    if (pitch <= -70 && d > 14 && d < 26) {
      const z = await page.evaluate(() => window.__bh.feet.z);
      if (z < 22) {
        if (stallAt === 0 || d > stallDepth + 0.4) {
          stallAt = Date.now();
          stallDepth = d;
        } else if (Date.now() - stallAt > 1200) {
          await setPitch(-48);
          const climb = Date.now();
          while (Date.now() - climb < 10000) {
            const s = await page.evaluate(() => ({
              z: window.__bh.feet.z,
              d: Math.max(0, -(window.__bh.feet.y + 0.9)),
              dead: window.__bh.blackout,
            }));
            if (s.dead || s.z > 22 || s.d > 26) break;
            await page.waitForTimeout(200);
          }
          await setPitch(pitch);
          stallAt = 0;
        }
      }
    }
    for (const m of marks) {
      if (seen.has(m)) continue;
      const hit = m === 41 ? d >= 40.4 : d >= m - 0.3 && d <= m + 1.4;
      if (!hit) continue;
      await page.keyboard.up('Space');
      if (travel !== pitch) {
        await setPitch(pitch);
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(m === 41 ? 1400 : 700);
      const sample = await page.evaluate(SAMPLE);
      const shot = `${OUT}/${tier}-p${Math.abs(pitch)}-${m}.png`;
      await page.screenshot({ path: shot });
      const luma = lumaOf(shot);
      if (m === 10) ref = luma;
      const washed = !ref || luma.std < ref.std * 0.55 || luma.mean > 225 || luma.mean > ref.mean + 35;
      const elevOk = sample.elev >= 40 && sample.elev <= 50;
      const diverOk = sample.outside === 0;
      const beadsOk = sample.beads >= 3;
      const lineOk = sample.lineHits === 0 && sample.near4 === 0;
      const floorOk = m !== 41 || Math.abs(sample.depth - 41) <= 0.08;
      const pass = elevOk && diverOk && beadsOk && lineOk && !washed && floorOk && !sample.blackout;
      const why = [
        !elevOk ? `elev ${sample.elev}` : '',
        !diverOk ? `outside ${sample.outside} low ${sample.lowY}` : '',
        !beadsOk ? `beads ${sample.beads}` : '',
        !lineOk ? `line ${sample.lineHits} near4 ${sample.near4}` : '',
        washed ? `luma ${luma.mean.toFixed(0)}/${luma.std.toFixed(0)}` : '',
        !floorOk ? `depth ${sample.depth}` : '',
      ].filter(Boolean).join(', ') || 'ok';
      add({
        id: `${tier} ${pitch}° ${m}m`,
        pass,
        detail: `d=${sample.depth} elev=${sample.elev} beads=${sample.beads} line=${sample.lineHits} std=${luma.std.toFixed(1)} ${why} ${sample.fit ? JSON.stringify(sample.fit) : ''}`,
      });
      seen.add(m);
      if (pitch === -65 && m === 41) {
        await setPitch(0);
        await page.waitForTimeout(800);
        const level = await page.evaluate(SAMPLE);
        const lshot = `${OUT}/${tier}-p${Math.abs(pitch)}-41-level.png`;
        await page.screenshot({ path: lshot });
        const ll = lumaOf(lshot);
        const lWashed = !ref || ll.std < ref.std * 0.55 || ll.mean > 225 || ll.mean > ref.mean + 35;
        const lPass = level.elev >= 40 && level.elev <= 50 && level.outside === 0 && level.beads >= 3 && level.lineHits === 0 && level.near4 === 0 && !lWashed && Math.abs(level.depth - 41) <= 0.15;
        add({
          id: `${tier} level floor`,
          pass: lPass,
          detail: `d=${level.depth} elev=${level.elev} beads=${level.beads} line=${level.lineHits} out=${level.outside} low=${level.lowY} std=${ll.std.toFixed(1)}`,
        });
      } else {
        await setPitch(travel);
        await page.keyboard.down('Space');
      }
    }
    await page.waitForTimeout(60);
  }
  if (seen.size < marks.length) {
    const why = await page.evaluate(() => (window.__bh.blackout ? 'blackout' : `max ${Math.max(0, -(window.__bh.feet.y + 0.9)).toFixed(1)}`));
    for (const m of marks) {
      if (!seen.has(m)) add({ id: `${tier} ${pitch}° ${m}m`, pass: false, detail: `never reached (${why}, saw ${maxDepth.toFixed(1)})` });
    }
  }
  await page.keyboard.up('Space');
  await context.close();
}

async function chargeAt(b, depth) {
  const { context, page } = await openPage(b, { width: 1280, height: 800, debug: true });
  const { setPitch } = await lockAndPitch(page);
  await setPitch(depth > 20 ? -65 : -35);
  await page.keyboard.down('Space');
  if (depth > 20) await page.keyboard.press('KeyF');
  const t0 = Date.now();
  while (Date.now() - t0 < 70000) {
    const d = await page.evaluate(() => Math.max(0, -(window.__bh.feet.y + 0.9)));
    if (d >= depth - 0.2) break;
    if (await page.evaluate(() => window.__bh.blackout)) break;
    await page.waitForTimeout(80);
  }
  await page.keyboard.up('Space');
  await page.evaluate(() => window.__bhDebug.warn(8));
  const t1 = Date.now();
  let charging = false;
  while (Date.now() - t1 < 3000) {
    charging = await page.evaluate(() => !!window.__bh.sharkCharging);
    if (charging) break;
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(200);
  const shot = `${OUT}/charge-${depth}.png`;
  await page.screenshot({ path: shot });
  const red = cornerRed(shot);
  const here = await page.evaluate(() => +Math.max(0, -(window.__bh.feet.y + 0.9)).toFixed(1));
  add({
    id: `charge ${depth}m`,
    pass: charging && red.redder,
    detail: `d=${here} charging=${charging} cornerR=${red.cr.toFixed(0)} centerR=${red.mr.toFixed(0)}`,
  });
  await context.close();
}

async function invariants(b) {
  const { context, page } = await openPage(b, { width: 1280, height: 800, debug: true });
  const { setPitch } = await lockAndPitch(page);
  await setPitch(-25);
  await page.keyboard.down('Space');
  const t0 = Date.now();
  let shark = false;
  while (Date.now() - t0 < 26000) {
    const info = await page.evaluate(() => {
      const g = window.__bh;
      let visible = 0;
      let near = 999;
      for (const s of g.life.swimmers) {
        if (s.species !== 'shark') continue;
        if (s.mesh.visible) visible++;
        near = Math.min(near, Math.hypot(s.x - g.feet.x, s.y - g.feet.y, s.z - g.feet.z));
      }
      return { t: g.life.t, visible, near };
    });
    if (info.t < 20 && (info.visible > 0 || info.near < 25)) shark = true;
    if (info.t >= 19.5) break;
    await page.waitForTimeout(400);
  }
  add({ id: 'no shark 20s', pass: !shark, detail: shark ? 'shark seen during grace' : 'clear' });
  await page.keyboard.up('Space');
  let coast = 1;
  for (let i = 0; i < 20 && coast > 0.05; i++) {
    const a = await page.evaluate(() => ({ x: window.__bh.feet.x, y: window.__bh.feet.y, z: window.__bh.feet.z }));
    await page.waitForTimeout(400);
    coast = await page.evaluate((p) => Math.hypot(window.__bh.feet.x - p.x, window.__bh.feet.y - p.y, window.__bh.feet.z - p.z) / 0.4, a);
  }
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'right', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'right', clickCount: 1 });
  await page.waitForTimeout(200);
  const a = await page.evaluate(() => ({ x: window.__bh.feet.x, y: window.__bh.feet.y, z: window.__bh.feet.z, vf: window.__bh.viewfinder }));
  await page.waitForTimeout(1500);
  const drift = await page.evaluate((p) => {
    const g = window.__bh;
    const dist = Math.hypot(g.feet.x - p.x, g.feet.y - p.y, g.feet.z - p.z);
    return { dist, vf: g.viewfinder, speed: dist / 1.5 };
  }, a);
  add({
    id: 'viewfinder drift',
    pass: a.vf && drift.vf && drift.speed < 0.1,
    detail: `${drift.speed.toFixed(3)} m/s`,
  });
  await context.close();
}

async function tap(page, sel, id) {
  await page.evaluate(({ sel, id }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: 'touch',
      clientX: r.x + 8,
      clientY: r.y + 8,
      isPrimary: true,
    }));
  }, { sel, id });
}

async function touchNudge(page, yaw, pit) {
  await page.evaluate(({ yaw, pit }) => {
    const id = 21;
    const x0 = 70;
    const y0 = 150;
    const start = new Touch({ identifier: id, target: document.body, clientX: x0, clientY: y0, pageX: x0, pageY: y0 });
    window.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [start], changedTouches: [start] }));
    const move = new Touch({ identifier: id, target: document.body, clientX: x0 + yaw, clientY: y0 + pit, pageX: x0 + yaw, pageY: y0 + pit });
    window.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [move], changedTouches: [move] }));
    window.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [move] }));
  }, { yaw, pit });
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function layoutOf(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const nodes = [...document.querySelectorAll('button, .lbl, .num, .warn, .vf-tag, .toast, h2, h3, .comment, .prize, .total-line, .who, .kicker, #surface-line')];
    const bad = [];
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const clip = el.scrollWidth > el.clientWidth + 2;
      const inside = r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;
      if (clip || !inside) bad.push({ text: text.slice(0, 24), clip, inside, w: +r.width.toFixed(0), h: +r.height.toFixed(0) });
    }
    const bar = document.querySelector('#o2bar')?.getBoundingClientRect() || null;
    const line = document.querySelector('#surface-line');
    const lineText = line ? line.textContent.trim() : '';
    const lineBox = line ? line.getBoundingClientRect() : null;
    const focus = document.querySelector('#focus')?.getBoundingClientRect() || null;
    const bracket = document.querySelector('.aim-bracket')?.getBoundingClientRect() || null;
    const card = document.querySelector('.modal .card, .modal .panel')?.getBoundingClientRect() || null;
    return {
      bad,
      lineText,
      lineBox: lineBox ? { left: lineBox.left, top: lineBox.top, right: lineBox.right, bottom: lineBox.bottom, sw: line?.scrollWidth, cw: line?.clientWidth } : null,
      bar: bar ? { left: bar.left, top: bar.top, right: bar.right, bottom: bar.bottom } : null,
      focus: focus && focus.width > 2 ? { left: focus.left, top: focus.top, right: focus.right, bottom: focus.bottom } : null,
      bracket: bracket && bracket.width > 2 ? { left: bracket.left, top: bracket.top, right: bracket.right, bottom: bracket.bottom } : null,
      card: card ? { left: card.left, top: card.top, right: card.right, bottom: card.bottom, vh, vw } : null,
      vh,
      vw,
    };
  });
}

async function touchLayouts(b) {
  const views = [
    { id: '740x360', width: 740, height: 360 },
    { id: '844x390', width: 844, height: 390 },
    { id: 'ipad', width: 1024, height: 768 },
  ];
  for (const view of views) {
    const { context, page } = await openPage(b, { ...view, touch: true });
    await page.click('#shop');
    await page.waitForSelector('.shop-grid');
    await page.waitForTimeout(200);
    let lay = await layoutOf(page);
    const shopIn = lay.card && lay.card.bottom <= lay.vh + 1 && lay.card.right <= lay.vw + 1 && lay.bad.length === 0;
    const suit = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.shop-grid .item')].find((n) => n.textContent.includes('防寒衣'));
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const btn = el.querySelector('button').getBoundingClientRect();
      return r.top >= -1 && btn.bottom <= window.innerHeight + 1 && btn.right <= window.innerWidth + 1;
    });
    add({ id: `${view.id} shop`, pass: shopIn && suit, detail: `bad=${lay.bad.length} suit=${suit}` });
    await page.screenshot({ path: `${OUT}/shop-${view.id}.png` });
    await page.click('#back');
    await page.waitForTimeout(200);
    await page.click('#dive');
    await page.waitForTimeout(500);
    lay = await layoutOf(page);
    add({ id: `${view.id} hud`, pass: lay.bad.length === 0, detail: lay.bad.slice(0, 3).map((x) => x.text).join(' | ') || 'ok' });
    await page.evaluate(() => {
      const el = document.querySelector('#touch-cam');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4, pointerType: 'touch', clientX: r.x + 8, clientY: r.y + 8 }));
    });
    await page.waitForTimeout(300);
    lay = await layoutOf(page);
    const tagClear = lay.focus && lay.bracket ? !overlaps(lay.focus, lay.bracket) : true;
    add({
      id: `${view.id} camera label`,
      pass: lay.bad.length === 0 && tagClear,
      detail: tagClear ? 'outside bracket' : 'overlaps bracket',
    });
    await tap(page, '#touch-cam', 5);
    await tap(page, '#touch-kick', 3);
    for (let i = 0; i < 22; i++) await touchNudge(page, 0, -46);
    const upAt = Date.now();
    let surfaced = false;
    while (Date.now() - upAt < 14000) {
      const here = await page.evaluate(() => ({
        d: Math.max(0, -(window.__bh.feet.y + 0.9)),
        p: window.__bh.viewPitch,
      }));
      if (here.p < 0.45) await touchNudge(page, 0, -40);
      if (here.d < 1.05) {
        surfaced = true;
        break;
      }
      await page.waitForTimeout(70);
    }
    await page.evaluate(() => {
      document.querySelector('#touch-kick').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, pointerType: 'touch' }));
    });
    await page.waitForTimeout(300);
    lay = await layoutOf(page);
    const sentence = '已到水面，氧气已回满。点「结束下潜」交片';
    const outside = lay.lineBox && lay.bar && !overlaps(lay.lineBox, lay.bar);
    const fits = lay.lineBox && lay.lineBox.sw <= lay.lineBox.cw + 2 && lay.lineBox.right <= lay.vw + 1 && lay.lineBox.bottom <= lay.vh + 1;
    add({
      id: `${view.id} surface`,
      pass: surfaced && lay.lineText === sentence && !!outside && !!fits && lay.bad.length === 0,
      detail: surfaced ? `${lay.lineText || 'missing'} ${outside ? 'clear' : 'overlaps'} ${fits ? 'fits' : 'clipped'} bad=${lay.bad.map((x) => x.text).join('|') || 0}` : 'did not surface',
    });
    await page.screenshot({ path: `${OUT}/surface-${view.id}.png` });
    await tap(page, '#touch-cam', 11);
    await page.waitForTimeout(250);
    await tap(page, '#touch-shutter', 12);
    const shotAt = Date.now();
    let shots = 0;
    while (Date.now() - shotAt < 3000) {
      shots = await page.evaluate(() => (window.__bh.photos || []).length);
      if (shots > 0) break;
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(400);
    await tap(page, '#touch-end', 13);
    await page.waitForSelector('#submit', { timeout: 8000 });
    await page.waitForTimeout(800);
    await page.locator('#submit').click();
    await page.waitForTimeout(500);
    lay = await layoutOf(page);
    const cardIn = lay.card && lay.card.top >= -1 && lay.card.bottom <= lay.vh + 1 && lay.card.left >= -1 && lay.card.right <= lay.vw + 1;
    add({
      id: `${view.id} card`,
      pass: shots > 0 && cardIn && lay.bad.length === 0,
      detail: `shots=${shots} bad=${lay.bad.map((x) => x.text).join('|') || 0}`,
    });
    await page.screenshot({ path: `${OUT}/card-${view.id}.png` });
    if (await page.locator('#next-card').count()) {
      await page.locator('#next-card').click();
      await page.waitForTimeout(300);
    }
    lay = await layoutOf(page);
    const settle = lay.card && lay.card.bottom <= lay.vh + 1 && lay.card.right <= lay.vw + 1;
    add({ id: `${view.id} settle`, pass: settle && lay.bad.length === 0, detail: `bad=${lay.bad.map((x) => x.text).join('|') || 0}` });
    await context.close();
  }
}

async function clownfish(b) {
  for (let n = 1; n <= 3; n++) {
    const { context, page } = await openPage(b, { width: 740, height: 360, touch: true });
    await page.click('#dive');
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const el = document.querySelector('#touch-kick');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', clientX: r.x + 12, clientY: r.y + 12, isPrimary: true }));
    });
    const t0 = Date.now();
    let arrived = false;
    while (Date.now() - t0 < 28000) {
      const aim = await page.evaluate(() => {
        const g = window.__bh;
        const clowns = g.life.snaps.filter((s) => s.species === 'clownfish');
        if (!clowns.length) return null;
        let best = clowns[0];
        let bestD = 1e9;
        for (const s of clowns) {
          const d = Math.hypot(s.x - g.feet.x, s.y - (g.feet.y + 1), s.z - g.feet.z);
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        const dx = best.x - g.feet.x;
        const dz = best.z - g.feet.z;
        const horiz = Math.hypot(dx, dz) || 0.001;
        let yawErr = Math.atan2(dx, dz) - g.viewYaw;
        while (yawErr > Math.PI) yawErr -= Math.PI * 2;
        while (yawErr < -Math.PI) yawErr += Math.PI * 2;
        const pitchWant = Math.atan2(best.y - (g.feet.y + 1.1), horiz);
        return { dist: bestD, yawPx: -yawErr / 0.00115, pitchPx: (g.viewPitch - pitchWant) / 0.00095 };
      });
      if (!aim) break;
      if (aim.dist < 4.3) {
        arrived = true;
        break;
      }
      const yaw = Math.max(-48, Math.min(48, aim.yawPx));
      const pit = Math.max(-36, Math.min(36, aim.pitchPx));
      await touchNudge(page, yaw, pit);
      await page.waitForTimeout(50);
    }
    await page.evaluate(() => {
      document.querySelector('#touch-kick').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, pointerType: 'touch' }));
    });
    const aimAt = Date.now();
    while (Date.now() - aimAt < 4000) {
      const aim = await page.evaluate(() => {
        const g = window.__bh;
        const clowns = g.life.snaps.filter((s) => s.species === 'clownfish');
        let bestD = 1e9;
        let yawErr = 0;
        for (const s of clowns) {
          const d = Math.hypot(s.x - g.feet.x, s.y - (g.feet.y + 1), s.z - g.feet.z);
          if (d < bestD) {
            bestD = d;
            yawErr = Math.atan2(s.x - g.feet.x, s.z - g.feet.z) - g.viewYaw;
          }
        }
        while (yawErr > Math.PI) yawErr -= Math.PI * 2;
        while (yawErr < -Math.PI) yawErr += Math.PI * 2;
        return { dist: bestD, yawPx: -yawErr / 0.00115 };
      });
      if (aim.dist >= 2.6 && aim.dist <= 4.6 && Math.abs(aim.yawPx) < 80) break;
      await touchNudge(page, Math.max(-40, Math.min(40, aim.yawPx)), 0);
      await page.waitForTimeout(60);
    }
    await tap(page, '#touch-cam', 11);
    const lockAt = Date.now();
    let locked = false;
    while (Date.now() - lockAt < 4000) {
      const focus = await page.evaluate(() => document.querySelector('#focus')?.textContent || '');
      if (focus.includes('小丑鱼') && focus.includes('已对准')) {
        locked = true;
        break;
      }
      await page.waitForTimeout(100);
    }
    await tap(page, '#touch-shutter', 12);
    await page.waitForTimeout(400);
    const shot = await page.evaluate(() => {
      const p = (window.__bh.photos || []).at(-1);
      return {
        species: p?.score?.species || null,
        total: p?.score?.total ?? null,
        focus: document.querySelector('#focus')?.textContent || '',
        locked: true,
      };
    });
    shot.locked = locked;
    await page.screenshot({ path: `${OUT}/clown-${n}.png` });
    const pass = arrived && shot.species === 'clownfish' && shot.total >= 60;
    add({ id: `clownfish ${n}`, pass, detail: `arrived=${arrived} ${shot.species} ${shot.total} ${shot.focus}` });
    await context.close();
  }
}

function printTable() {
  const head = ['result', 'check', 'detail'];
  const data = rows.map((r) => [r.pass ? 'PASS' : 'FAIL', r.id, r.detail]);
  const widths = head.map((h, i) => Math.max(h.length, ...data.map((row) => String(row[i]).length)));
  const line = (cols) => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log('\n' + line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of data) console.log(line(row));
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failed} passed, ${failed} failed`);
  return failed;
}

const only = process.env.VERIFY_ONLY || 'all';
const b = await browser();
try {
  if (only === 'all' || only === 'invariants') await invariants(b);
  if (only === 'all' || only === 'charge') {
    await chargeAt(b, 10);
    await chargeAt(b, 41);
  }
  if (only === 'all' || only === 'dive') {
    for (const low of [false, true]) {
      for (const pitch of [-65, -72]) {
        if (only === 'dive' && process.env.VERIFY_TIER && process.env.VERIFY_TIER !== (low ? 'low' : 'def')) continue;
        if (only === 'dive' && process.env.VERIFY_PITCH && Number(process.env.VERIFY_PITCH) !== pitch) continue;
        await diveScenario(b, { pitch, low, tier: low ? 'low' : 'def' });
      }
    }
  }
  if (only === 'all' || only === 'touch') await touchLayouts(b);
  if (only === 'all' || only === 'clown') await clownfish(b);
} finally {
  await b.close();
}
const failed = printTable();
const { writeFileSync } = await import('node:fs');
writeFileSync(`${OUT}/report.json`, JSON.stringify(rows, null, 2));
process.exit(failed ? 1 : 0);
