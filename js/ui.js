// Sea Raiders — DOM HUD, menus, shop (MIT)

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.menu = $('menu');
    this.hud = $('hud');
    this.shop = $('shop');
    this.gameover = $('gameover');
    this.announceEl = $('announce');
    this._announceTimer = null;
    this._goldPopAt = 0;
    this.onNextWave = () => {};
  }

  show(el) { el.classList.remove('hidden'); }
  hide(el) { el.classList.add('hidden'); }

  showMenu() {
    this.show(this.menu);
    this.hide(this.hud);
    this.hide(this.shop);
    this.hide(this.gameover);
  }

  showGame(multi = false) {
    this.hide(this.menu);
    this.hide(this.shop);
    this.hide(this.gameover);
    this.show(this.hud);
    $('leaderboard').classList.toggle('hidden', !multi);
    $('wave-row').style.display = multi ? 'none' : '';
  }

  announce(text, secs = 2.2) {
    this.announceEl.textContent = text;
    this.announceEl.classList.add('show');
    clearTimeout(this._announceTimer);
    this._announceTimer = setTimeout(() => this.announceEl.classList.remove('show'), secs * 1000);
  }

  setWave(n) { $('wave-text').textContent = n; }

  popGold() {
    // quick flash of the gold row when coins land in the hold
    const row = $('gold-row');
    row.style.transform = 'scale(1.25)';
    row.style.transition = 'transform 0.08s';
    clearTimeout(this._goldPopAt);
    this._goldPopAt = setTimeout(() => { row.style.transform = 'scale(1)'; }, 100);
  }

  updateHUD(game) {
    const p = game.player;
    const frac = Math.max(0, p.hp / p.maxHp);
    const fill = $('hp-fill');
    fill.style.width = `${frac * 100}%`;
    fill.classList.toggle('low', frac < 0.35);
    $('hp-text').textContent = `${Math.ceil(p.hp)}`;
    $('gold-text').textContent = game.gold;

    // active powerups
    const pw = $('power-row');
    const tags = [];
    if (game.powerups.rapid > 0) tags.push(`⚡ ${Math.ceil(game.powerups.rapid)}s`);
    if (game.powerups.spread > 0) tags.push(`✸ ${Math.ceil(game.powerups.spread)}s`);
    if (p.braceCd > 0 && !p.braced) {
      const overlay = document.querySelector('#btn-brace .cd-overlay');
      if (overlay) overlay.style.height = `${(p.braceCd / 6) * 100}%`;
    } else {
      const overlay = document.querySelector('#btn-brace .cd-overlay');
      if (overlay) overlay.style.height = '0%';
    }
    const html = tags.map((t) => `<span class="pwr">${t}</span>`).join('');
    if (pw.innerHTML !== html) pw.innerHTML = html;

    // multiplayer leaderboard
    if (game.mode === 'multi' && game.net) {
      const lb = $('leaderboard');
      const rows = [...game.net.scores]
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((s) => `<div class="${s.id === game.net.id ? 'me' : ''}">⚓ ${escapeHtml(s.name)} — ${s.score}</div>`)
        .join('');
      const html2 = rows || '<div>⚓ just you out here…</div>';
      if (lb.innerHTML !== html2) lb.innerHTML = html2;
    }
  }

  openShop(game) {
    game.running = false;
    this.show(this.shop);
    $('shop-gold-text').textContent = game.gold;

    const wrap = $('shop-items');
    wrap.innerHTML = '';
    for (const item of game.shopItems()) {
      const btn = document.createElement('button');
      btn.className = 'shop-item';
      btn.disabled = item.maxed || !item.affordable;
      btn.innerHTML = `
        <span class="si-lvl">${item.maxed ? 'MAX' : item.repeat ? '' : `Lv ${item.lvl}`}</span>
        <div class="si-name">${item.name}</div>
        <div class="si-desc">${item.desc}</div>
        <div class="si-cost">🪙 ${item.maxed ? '—' : item.cost}</div>`;
      btn.addEventListener('click', () => {
        if (game.buyUpgrade(item.key)) this.openShop(game); // re-render with new prices
      });
      wrap.appendChild(btn);
    }
  }

  closeShopAndContinue(game) {
    this.hide(this.shop);
    game.running = true;
    game.resumeFromShop();
  }

  showGameOver(title, stats) {
    this.hide(this.hud);
    this.show(this.gameover);
    this.gameover.querySelector('h2').textContent = `☠ ${title}`;
    $('gameover-stats').textContent = stats;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
