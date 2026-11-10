/// <reference types="vite/client" />
import './style.css';
import { Game } from './game';

const canvas = document.querySelector<HTMLCanvasElement>('#c');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('Missing game root');

const game = new Game(canvas, ui);
if (import.meta.env.DEV) {
  (window as unknown as { __bh: Game }).__bh = game;
}
game.start();
