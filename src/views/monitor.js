import { fmtTime, escapeHtml as esc } from '../util.js';

/**
 * Live "Active Cues" panel. Rows are reconciled (added/removed) when the audio
 * engine signals a change; progress bars/times animate in a private rAF loop
 * reading audio.playbacks(). Stopping a single voice is an audio concern, so it
 * calls audio.stopPid directly. `onCount(n)` lets the app reflect the active
 * count elsewhere (the count badge and the mobile sheet button).
 */
export class Monitor {
  constructor(root, audio, { onCount } = {}) {
    this.root = root;
    this.audio = audio;
    this.onCount = onCount || (() => {});
    this.items = new Map();   // pid -> { root, fill, el, re }

    audio.on('change', () => this._reconcile());
    this._reconcile();

    const tick = () => { this._tick(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  _reconcile() {
    const live = new Map(this.audio.playbacks().map(p => [p.pid, p]));
    for (const [pid, item] of this.items)
      if (!live.has(pid)) { item.root.remove(); this.items.delete(pid); }
    for (const [pid, p] of live) {
      if (this.items.has(pid)) continue;
      const root = document.createElement('div');
      root.className = 'mon-item';
      root.innerHTML = `<div class="mon-top">
          <div class="mon-name"><span class="q">${esc(p.num)}</span>${esc(p.name)}</div>
          <button class="mon-stop" title="Stop">×</button></div>
        <div class="mon-bar"><div class="mon-fill"></div></div>
        <div class="mon-time"><span class="el">0:00</span><span class="re"></span></div>`;
      root.querySelector('.mon-stop').onclick = () => this.audio.stopPid(pid, 0.4);
      this.root.appendChild(root);
      this.items.set(pid, {
        root, fill: root.querySelector('.mon-fill'),
        el: root.querySelector('.el'), re: root.querySelector('.re'),
      });
    }
    const n = live.size;
    this.onCount(n);
    if (!n && !this.root.querySelector('.mon-empty'))
      this.root.innerHTML = `<div class="mon-empty">Nothing playing.</div>`;
    else if (n) { this.root.querySelector('.mon-empty')?.remove(); }
  }

  _tick() {
    for (const p of this.audio.playbacks()) {
      const m = this.items.get(p.pid); if (!m) continue;
      m.fill.style.width = (p.position * 100) + '%';
      m.el.textContent = fmtTime(p.elapsed);
      if (p.loop) m.re.innerHTML = '<span class="mon-loop">↻ loop</span>';
      else m.re.textContent = '−' + fmtTime(p.remaining);
      m.fill.classList.toggle('fading', p.fading);
    }
  }
}
