# ⛵ Sea Raiders

An **open source, web-based pirate ship battle game** — steer your ship with a thumb,
unleash broadsides, survive escalating waves of pirate AI, plunder gold, upgrade your
vessel, and (optionally) battle friends on a shared multiplayer sea.

Inspired by the feel of classic mobile naval-battle games, built entirely from scratch:
no game engine, no art assets, no build step. Just vanilla JavaScript, Canvas 2D, and a
tiny Node.js WebSocket server. MIT licensed.

## ✨ Features

- **One-thumb sailing** — touch anywhere and drag: a floating virtual joystick appears
  under your thumb. Point where you want to go; push further for more sail. Works with
  mouse drag and WASD/arrows too.
- **Smooth, physical boat movement** — momentum, anisotropic drag (ships carve forward
  but resist sliding sideways), speed-dependent rudder authority, sails that ease in
  and out, idle bobbing, wake trails and bow spray.
- **Attack & defend** — `FIRE` auto-aims a broadside at the nearest threat (both sides
  if nothing's near); `BRACE` cuts incoming damage by 60% for two seconds on a cooldown.
  Timing your brace against an enemy volley is the heart of a duel.
- **Low-poly 3D look, zero dependencies** — a tiny flat-shaded polygon engine
  (`js/render3d.js`) runs on plain Canvas 2D. The camera looks down at the sea from
  an angle, so you see full ship detail: faceted hulls, planked decks, raised
  quarterdecks, gun ports, masts with billowing sails, streaming flags. Rocks are
  shaded polygon crags, cannonballs arc in real height with shadows on the water,
  and explosion debris flies ballistically.
- **A living sea** — the world ends in a wall of drifting low-poly clouds, gulls
  wheel overhead, explosive powder barrels float between the islets (shoot one for
  an area blast — they chain-react, and the blast doesn't care whose hull is near).
- **Detection & reinforcements** — enemy captains patrol blind and stay hidden from
  your minimap until they spot you. Get seen and a **!** flashes over their mast,
  nearby ships are alerted, and the first sighting of every wave whistles up
  reinforcements that sail in out of the cloud wall.
- **Wave survival with progression** — sloops, brigs, and boss galleons with a
  state-machine AI (patrol → chase → circle for a broadside → flee when crippled).
  Between waves, dock at the Port of Call and spend plundered gold on hull, cannons,
  powder, sails, crew, and repairs.
- **Loot & powerups** — sunken ships scatter gold crates plus Rapid Fire ⚡,
  Grapeshot ✸, and hull Repairs 🛠.
- **Multiplayer (optional)** — a ~250-line Node.js WebSocket server runs a shared
  free-for-all sea with interpolated remote ships, kill feed, scoreboard, and respawns.
- **Mobile-first** — safe-area aware UI, retina-crisp canvas, no scrolling/zooming,
  installable-feeling fullscreen play.

## 🚀 Quick start

### Single player only (no install at all)

Serve the folder with any static server and open it:

```bash
npx http-server .        # or: python3 -m http.server 8000
```

### Full game with multiplayer

```bash
npm install   # installs the single dependency: ws
npm start     # serves the game AND the multiplayer sea on :8080
```

Open **http://localhost:8080** — on as many devices/browsers as you like. Hit
**Multiplayer**, pick a captain name, and join. The server URL is pre-filled with the
host the page came from; to play across a LAN, just open `http://<your-ip>:8080` on
your phone.

Set a custom port with `PORT=3000 npm start`.

## 🎮 Controls

| Action | Touch | Keyboard |
|---|---|---|
| Steer & throttle | hold + drag anywhere (virtual joystick) | `WASD` / arrows |
| Fire broadside | `FIRE` button | `Space` |
| Brace (damage shield) | `BRACE` button | `Shift` |

## 🗂 Project layout

```
index.html          game shell + HUD/menus
css/style.css       UI styling
js/main.js          boot, menu wiring, game loop
js/game.js          world: waves, combat, loot, barrels, camera, shop, minimap
js/entities.js      simulation: ship physics, cannonballs, loot, barrels, rocks, particles
js/render3d.js      low-poly 3D engine: projection, flat shading, ship/rock/cloud meshes
js/enemy.js         enemy captain AI, detection, wave composition
js/input.js         thumb joystick / mouse / keyboard
js/water.js         animated procedural ocean
js/net.js           multiplayer client (snapshot interpolation)
js/ui.js            DOM HUD, shop, announcements
server/server.js    static host + WebSocket relay server
```

## 🌐 Multiplayer architecture & trust model

The server is a **relay with sanity checks**, not a full authoritative simulation —
that keeps it tiny, dependency-light, and the movement perfectly smooth:

- Each client simulates its **own** ship and streams position snapshots (~15 Hz).
- The server rebroadcasts snapshots at a fixed tick (~12 Hz); clients render remote
  ships ~120 ms in the past and interpolate between snapshots, so other players glide
  smoothly even over jittery connections.
- Fire events are relayed (rate-limited server-side); each client re-simulates the
  volley locally so everyone sees the same cannonballs.
- Hits are reported by the shooter; the server **clamps damage, rate-limits fire, and
  rejects hits when the shooter is implausibly far from the target** before relaying.

That's honest-player-grade anti-cheat — fine for friends and LAN parties. If you want
competitive integrity, the protocol is small enough to move the simulation
server-side; PRs welcome.

## 🛠 Contributing

It's all plain ES modules — open the files and hack away. Some fun starter ideas:

- Wind direction that affects sail speed
- Kraken boss event
- Team battles / co-op wave survival in multiplayer
- Sound effects (everything is wired for it — search for `muzzleFlash`, `explosion`)
- Persistent high scores

## 📜 License

[MIT](LICENSE) — do anything you like, just keep the notice.
