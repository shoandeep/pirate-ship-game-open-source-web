// Sea Raiders — multiplayer client over WebSocket (MIT)
//
// Lightweight relay model: each client simulates its own ship and streams
// state snapshots; remote ships are rendered ~120 ms in the past and
// interpolated between snapshots so movement stays silky even on a bumpy
// connection. Fire events and damage are relayed through the server, which
// sanity-checks them.

const SEND_HZ = 15;
const INTERP_DELAY = 0.12; // seconds behind real time for remote ships

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.players = new Map(); // id -> { name, color, score, buf: [{t, x, y, h, sail, hp}], hp, dead }
    this.scores = [];
    this._lastSend = 0;
    this._clock = 0;

    // event hooks the game wires up
    this.onWelcome = () => {};
    this.onFire = () => {};
    this.onDamage = () => {};
    this.onKill = () => {};
    this.onLeave = () => {};
    this.onClose = () => {};
    this.onError = () => {};
  }

  connect(url, name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws.onopen = () => {
        this._send({ t: 'join', name });
      };
      this.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome' && !settled) {
          settled = true;
          this.id = msg.id;
          this.connected = true;
          for (const p of msg.players) this._addPlayer(p);
          this.onWelcome(msg);
          resolve(msg);
        } else {
          this._handle(msg);
        }
      };
      this.ws.onerror = (e) => {
        this.onError(e);
        if (!settled) { settled = true; reject(new Error('connection failed')); }
      };
      this.ws.onclose = () => {
        this.connected = false;
        this.onClose();
        if (!settled) { settled = true; reject(new Error('connection closed')); }
      };
    });
  }

  _addPlayer(p) {
    if (p.id === this.id) return;
    this.players.set(p.id, { name: p.name, color: p.color, score: p.score || 0, buf: [], hp: 100, dead: false });
  }

  _handle(msg) {
    switch (msg.t) {
      case 'player_join':
        this._addPlayer(msg);
        break;
      case 'snapshot': {
        // server broadcasts everyone's latest state at a fixed tick
        for (const st of msg.states) {
          if (st.id === this.id) continue;
          const p = this.players.get(st.id);
          if (!p) continue;
          p.buf.push({ t: this._clock, x: st.x, y: st.y, h: st.h, sail: st.sail });
          if (p.buf.length > 30) p.buf.shift();
          p.hp = st.hp;
          p.dead = st.dead;
        }
        break;
      }
      case 'fire':
        if (msg.id !== this.id) this.onFire(msg);
        break;
      case 'damage':
        this.onDamage(msg);
        break;
      case 'kill':
        this.onKill(msg);
        break;
      case 'scores':
        this.scores = msg.scores;
        break;
      case 'leave':
        this.players.delete(msg.id);
        this.onLeave(msg);
        break;
    }
  }

  update(dt, myShip) {
    if (!this.connected) return;
    this._clock += dt;
    this._lastSend += dt;
    if (this._lastSend >= 1 / SEND_HZ && myShip) {
      this._lastSend = 0;
      this._send({
        t: 'state',
        x: Math.round(myShip.x), y: Math.round(myShip.y),
        h: +myShip.heading.toFixed(3),
        sail: +myShip.sail.toFixed(2),
        hp: Math.round(myShip.hp),
        dead: myShip.dead,
      });
    }
  }

  /** interpolated render state for a remote player, or null if not enough data */
  remoteState(p) {
    const buf = p.buf;
    if (buf.length === 0) return null;
    const target = this._clock - INTERP_DELAY;
    if (buf.length === 1 || buf[0].t > target) return buf[buf.length - 1];

    for (let i = buf.length - 1; i > 0; i--) {
      const a = buf[i - 1], b = buf[i];
      if (a.t <= target && target <= b.t) {
        const f = (target - a.t) / Math.max(1e-6, b.t - a.t);
        let dh = b.h - a.h;
        if (dh > Math.PI) dh -= Math.PI * 2;
        if (dh < -Math.PI) dh += Math.PI * 2;
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          h: a.h + dh * f,
          sail: a.sail + (b.sail - a.sail) * f,
        };
      }
    }
    return buf[buf.length - 1];
  }

  sendFire(side, x, y, h) { this._send({ t: 'fire', side, x: Math.round(x), y: Math.round(y), h: +h.toFixed(3) }); }
  sendHit(targetId, dmg) { this._send({ t: 'hit', target: targetId, dmg: Math.round(dmg) }); }
  sendDied(killerId) { this._send({ t: 'died', killer: killerId }); }
  sendRespawn() { this._send({ t: 'respawn' }); }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  disconnect() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.connected = false;
    this.players.clear();
  }
}
