// Sea Raiders — multiplayer relay server + static file host (MIT)
//
// One process does it all:
//   * serves the game client over HTTP (so `npm start` → play at http://localhost:8080)
//   * runs the WebSocket sea: join/leave, state snapshots, fire/damage relay,
//     kills, scores, and loose sanity checks on everything clients claim.
//
// Trust model: clients simulate their own ships (keeps the server tiny and the
// movement perfectly smooth). The server clamps damage, rate-limits fire, and
// validates shooter/target distance — good enough for friendly seas. See README.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const SNAPSHOT_HZ = 12;
const MAX_DAMAGE = 60;          // hard cap per reported hit
const MAX_HIT_DIST = 600;       // shooter must plausibly be in range of the target
const MIN_FIRE_INTERVAL = 250;  // ms between broadsides per player
const MAX_NAME = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------- HTTP (static)

const httpServer = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

// ---------------------------------------------------------- WebSocket sea

const wss = new WebSocketServer({ server: httpServer });

let nextId = 1;
const players = new Map(); // id -> { ws, name, score, state, lastFireAt, alive }

const sanitizeName = (n) =>
  String(n || 'Captain').replace(/[^\w\s\-'!.]/g, '').trim().slice(0, MAX_NAME) || 'Captain';

function broadcast(obj, exceptId = null) {
  const data = JSON.stringify(obj);
  for (const [id, p] of players) {
    if (id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

function broadcastScores() {
  broadcast({
    t: 'scores',
    scores: [...players].map(([id, p]) => ({ id, name: p.name, score: p.score })),
  });
}

wss.on('connection', (ws) => {
  let myId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg !== 'object' || msg === null) return;

    // first message must be a join
    if (myId === null) {
      if (msg.t !== 'join') { ws.close(); return; }
      myId = nextId++;
      const player = {
        ws,
        name: sanitizeName(msg.name),
        score: 0,
        state: null,
        lastFireAt: 0,
        alive: true,
      };
      players.set(myId, player);

      ws.send(JSON.stringify({
        t: 'welcome',
        id: myId,
        players: [...players].map(([id, p]) => ({ id, name: p.name, score: p.score })),
      }));
      broadcast({ t: 'player_join', id: myId, name: player.name, score: 0 }, myId);
      broadcastScores();
      console.log(`⚓ ${player.name} (#${myId}) joined — ${players.size} at sea`);
      return;
    }

    const me = players.get(myId);
    if (!me) return;

    switch (msg.t) {
      case 'state': {
        const { x, y, h, sail, hp, dead } = msg;
        if (![x, y, h].every(Number.isFinite)) return;
        me.state = {
          id: myId,
          x: Math.max(0, Math.min(10000, x)),
          y: Math.max(0, Math.min(10000, y)),
          h: +h || 0,
          sail: Math.max(0, Math.min(1, +sail || 0)),
          hp: Math.max(0, Math.min(1000, +hp || 0)),
          dead: !!dead,
        };
        me.alive = !dead;
        break;
      }

      case 'fire': {
        const now = Date.now();
        if (now - me.lastFireAt < MIN_FIRE_INTERVAL) return; // rate limit
        me.lastFireAt = now;
        if (![msg.x, msg.y, msg.h].every(Number.isFinite)) return;
        broadcast({ t: 'fire', id: myId, side: msg.side === -1 ? -1 : 1, x: msg.x, y: msg.y, h: msg.h }, myId);
        break;
      }

      case 'hit': {
        // shooter reports a hit on a target; clamp & sanity-check, then relay
        const target = players.get(msg.target);
        if (!target || msg.target === myId || !target.alive) return;
        const dmg = Math.max(1, Math.min(MAX_DAMAGE, Math.round(msg.dmg) || 0));
        if (me.state && target.state) {
          const d = Math.hypot(me.state.x - target.state.x, me.state.y - target.state.y);
          if (d > MAX_HIT_DIST) return; // shooter nowhere near the target
        }
        if (target.ws.readyState === target.ws.OPEN) {
          target.ws.send(JSON.stringify({ t: 'damage', target: msg.target, dmg, from: myId }));
        }
        break;
      }

      case 'died': {
        if (!me.alive) return;
        me.alive = false;
        const killer = players.get(msg.killer);
        if (killer && msg.killer !== myId) killer.score += 1;
        broadcast({
          t: 'kill',
          victim: myId,
          victimName: me.name,
          killer: killer ? msg.killer : null,
          killerName: killer ? killer.name : 'the sea',
        });
        broadcastScores();
        break;
      }

      case 'respawn':
        me.alive = true;
        break;
    }
  });

  ws.on('close', () => {
    if (myId !== null && players.has(myId)) {
      const name = players.get(myId).name;
      players.delete(myId);
      broadcast({ t: 'leave', id: myId });
      broadcastScores();
      console.log(`🌊 ${name} (#${myId}) left — ${players.size} at sea`);
    }
  });

  ws.on('error', () => { /* close handler does the cleanup */ });
});

// fixed-rate snapshot broadcast of everyone's latest state
setInterval(() => {
  if (players.size === 0) return;
  const states = [];
  for (const p of players.values()) if (p.state) states.push(p.state);
  if (states.length) broadcast({ t: 'snapshot', states });
}, 1000 / SNAPSHOT_HZ);

httpServer.listen(PORT, () => {
  console.log(`Sea Raiders server sailing on http://localhost:${PORT}`);
  console.log(`WebSocket sea open on ws://localhost:${PORT}`);
});
