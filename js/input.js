// Sea Raiders — unified input: thumb virtual joystick, mouse drag, keyboard (MIT)
import { clamp, angleDiff } from './utils.js';

const JOY_RADIUS = 64; // px from anchor for full throttle

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();

    // virtual joystick (appears wherever the thumb lands on the steering zone)
    this.joyActive = false;
    this.joyAnchor = { x: 0, y: 0 };
    this.joyPos = { x: 0, y: 0 };
    this.joyTouchId = null;

    // action buttons
    this.fireHeld = false;
    this.braceHeld = false;

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this._joyEnd(); });

    // --- touch: steering zone is anywhere not covered by an action button ---
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.joyTouchId === null) {
          this.joyTouchId = t.identifier;
          this._joyStart(t.clientX, t.clientY);
        }
      }
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyTouchId) this._joyMove(t.clientX, t.clientY);
      }
    }, { passive: false });
    const touchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyTouchId) { this.joyTouchId = null; this._joyEnd(); }
      }
    };
    this.canvas.addEventListener('touchend', touchEnd);
    this.canvas.addEventListener('touchcancel', touchEnd);

    // --- mouse fallback (desktop drag-steering) ---
    this.canvas.addEventListener('mousedown', (e) => this._joyStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => { if (this.joyActive && this.joyTouchId === null) this._joyMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (this.joyTouchId === null) this._joyEnd(); });

    // --- HUD action buttons (work with touch and mouse) ---
    this._bindButton('btn-fire', (held) => { this.fireHeld = held; });
    this._bindButton('btn-brace', (held) => { this.braceHeld = held; });
  }

  _bindButton(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => { e.preventDefault(); el.classList.add('held'); setter(true); };
    const up = (e) => { e.preventDefault(); el.classList.remove('held'); setter(false); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
  }

  _joyStart(x, y) {
    this.joyActive = true;
    this.joyAnchor.x = x; this.joyAnchor.y = y;
    this.joyPos.x = x; this.joyPos.y = y;
  }
  _joyMove(x, y) { this.joyPos.x = x; this.joyPos.y = y; }
  _joyEnd() { this.joyActive = false; }

  /**
   * Translate raw input into ship controls.
   * Joystick: point your thumb where you want to go — the ship turns toward it,
   * throttle scales with how far you push.
   */
  getControl(shipHeading) {
    let steer = 0, throttle = 0;

    if (this.joyActive) {
      const dx = this.joyPos.x - this.joyAnchor.x;
      const dy = this.joyPos.y - this.joyAnchor.y;
      const mag = Math.hypot(dx, dy);
      if (mag > 8) {
        const want = Math.atan2(dy, dx);
        const diff = angleDiff(shipHeading, want);
        steer = clamp(diff * 2.2, -1, 1);
        throttle = clamp(mag / JOY_RADIUS, 0, 1);
        // ease off the throttle while doing a hard turn-around — feels like a real helm
        if (Math.abs(diff) > 2.2) throttle *= 0.55;
      }
    }

    // keyboard overrides / merges
    const k = this.keys;
    if (k.has('ArrowUp') || k.has('KeyW')) throttle = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) throttle = Math.min(throttle, 0.15);
    if (k.has('ArrowLeft') || k.has('KeyA')) steer = -1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer = 1;

    const fire = this.fireHeld || k.has('Space');
    const brace = this.braceHeld || k.has('ShiftLeft') || k.has('ShiftRight');

    return { steer, throttle, fire, brace };
  }

  /** draw the floating thumb-stick so players can see their helm */
  drawJoystick(ctx) {
    if (!this.joyActive) return;
    const { joyAnchor: a, joyPos: p } = this;
    const dx = p.x - a.x, dy = p.y - a.y;
    const mag = Math.hypot(dx, dy);
    const cl = mag > JOY_RADIUS ? JOY_RADIUS / mag : 1;

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(a.x, a.y, JOY_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(a.x + dx * cl, a.y + dy * cl, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
