/// <reference types="vite/client" />
import './style.css';
import { Game } from './game';

const canvas = document.querySelector<HTMLCanvasElement>('#c');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('Missing game root');

function savedLang(): 'zh' | 'en' {
  try {
    const raw = localStorage.getItem('breath-hold-dive-v1');
    if (raw) {
      const data = JSON.parse(raw) as { lang?: string };
      if (data.lang === 'en') return 'en';
    }
  } catch {
    /* a broken save still gets the Chinese default */
  }
  return 'zh';
}

function showWebglFail(): void {
  const text =
    savedLang() === 'zh'
      ? '你的浏览器无法启动 3D。请换用最新的 Chrome、Edge 或 Firefox，并打开硬件加速。'
      : 'This browser could not start 3D. Use a current Chrome, Edge, or Firefox with hardware acceleration turned on.';
  ui!.innerHTML = `<div class="webgl-fail"><p>${text}</p></div>`;
}

function isWebglError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /webgl|gl context/i.test(msg);
}

function webglSupported(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    return !!gl;
  } catch {
    return false;
  }
}

if (!webglSupported()) {
  showWebglFail();
} else try {
  const game = new Game(canvas, ui);
  const debugOn = new URLSearchParams(location.search).has('debug');
  if (import.meta.env.DEV || debugOn) {
    (window as unknown as { __bh: Game }).__bh = game;
  }
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    showWebglFail();
  });
  game.start();
} catch (err) {
  if (!isWebglError(err)) throw err;
  console.error(err);
  showWebglFail();
}
