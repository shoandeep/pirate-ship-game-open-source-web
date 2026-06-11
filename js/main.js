// Sea Raiders — entry point: boot, menus, game loop (MIT)
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Net } from './net.js';

const canvas = document.getElementById('game');
const ui = new UI();
const input = new Input(canvas);
const game = new Game(canvas, input, ui);

let net = null;

// ---------- canvas sizing (crisp on retina, fills the viewport) ----------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // game logic uses CSS pixels
  game.canvas = { width: window.innerWidth, height: window.innerHeight };
}
window.addEventListener('resize', resize);

// the Game reads width/height off `game.canvas`; keep the real canvas for drawing
game.canvas = { width: window.innerWidth, height: window.innerHeight };
game.ctx = canvas.getContext('2d');
resize();

// ---------- menu wiring ----------
const $ = (id) => document.getElementById(id);

$('btn-single').addEventListener('click', () => {
  ui.showGame(false);
  game.startSingle();
});

$('btn-multi').addEventListener('click', () => {
  $('multi-form').classList.toggle('hidden');
  const urlInput = $('server-url');
  if (!urlInput.value) {
    // sensible default: same host the page came from
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    urlInput.value = location.host ? `${proto}://${location.host}` : 'ws://localhost:8080';
  }
});

$('btn-connect').addEventListener('click', async () => {
  const name = ($('player-name').value || 'Captain').trim().slice(0, 12);
  const url = $('server-url').value.trim();
  const status = $('net-status');
  status.textContent = 'Raising anchor…';
  try {
    net = new Net();
    await net.connect(url, name);
    status.textContent = '';
    ui.showGame(true);
    game.startMulti(net, name);
  } catch (err) {
    status.textContent = `⚠ Couldn't reach ${url} — is the server running? (npm start)`;
  }
});

$('btn-next-wave').addEventListener('click', () => ui.closeShopAndContinue(game));

$('btn-restart').addEventListener('click', () => {
  if (net) { net.disconnect(); net = null; }
  ui.showGame(false);
  game.startSingle();
});

$('btn-tomenu').addEventListener('click', () => {
  if (net) { net.disconnect(); net = null; }
  ui.showMenu();
});

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  // clamp dt so tab-switches don't teleport ships
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;

  // a single bad frame must never kill the render loop
  try {
    game.update(dt);
    game.draw();
  } catch (err) {
    console.error('frame error:', err);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

ui.showMenu();

// handy for debugging and modding from the console
window.game = game;
