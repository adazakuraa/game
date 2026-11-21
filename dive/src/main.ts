import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Missing #game-canvas element.');

// let the loading screen paint before the heavy procedural build
requestAnimationFrame(() =>
  setTimeout(() => {
    const t0 = performance.now();
    (window as unknown as Record<string, unknown>).__T_SCRIPT__ = Math.round(t0);
    const game = new Game(canvas);
    game.start();
  }, 30),
);
