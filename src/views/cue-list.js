import { fmtTime, escapeHtml as esc } from '../util.js';

const TYPE = {
  audio: { ic: '♪', cls: 'type-audio' },
  stop:  { ic: '■', cls: 'type-stop' },
  wait:  { ic: '⏱', cls: 'type-wait' },
};

const EMPTY_HTML = `<div class="empty"><h2>No cues yet</h2>
  <p>Drop audio files anywhere, or click <b>+ Add Audio</b>.</p>
  <p style="margin-top:18px;color:var(--ink-faint)">
    <kbd>Space</kbd> GO &nbsp; <kbd>Esc</kbd> Stop All &nbsp; <kbd>↑</kbd><kbd>↓</kbd> move playhead</p></div>`;

/**
 * Renders the cue list and handles selection + pointer-based drag reorder.
 * Reads show.cues / show.current and calls show.setCurrent / show.move; never
 * touches storage or audio scheduling. `onEdit(i)` fires when the per-row edit
 * affordance is used (the app uses it to open the mobile sheet).
 */
export class CueList {
  constructor(root, show, audio, { onEdit } = {}) {
    this.root = root;
    this.show = show;
    this.audio = audio;
    this.onEdit = onEdit || (() => {});
    this.rows = new Map();     // cueId -> row element, for cheap targeted updates
    this._drag = null;

    this._wirePointer();
    this._wireClick();

    show.on('cues', () => this.render());
    show.on('current', () => { this._markCurrent(); this._scrollIntoView(); });
    show.on('cueChanged', ({ index }) => this._renderRow(index));
    audio.on('change', () => this._markPlaying());

    this.render();
  }

  render() {
    this.rows.clear();
    const cues = this.show.cues;
    if (!cues.length) { this.root.innerHTML = EMPTY_HTML; return; }
    const frag = document.createDocumentFragment();
    cues.forEach((c, i) => { const row = this._makeRow(c, i); frag.appendChild(row); this.rows.set(c.id, row); });
    this.root.replaceChildren(frag);
    this._markPlaying();
  }

  // ---- row building ----
  _makeRow(c, i) {
    const t = TYPE[c.type];
    const row = document.createElement('div');
    row.className = 'row' + (i === this.show.current ? ' current' : '');
    row.dataset.i = i;
    const info = c.type === 'stop'
      ? (c.target === 'all' ? 'All cues' : 'Cue ' + (this.show.cueById(c.target)?.number ?? '?'))
      : (c.fileName || '—');
    const dur = c.type === 'audio' ? (c.loop ? '∞ loop' : fmtTime(c.duration)) : '';
    row.innerHTML = `
      <button class="row-grip" tabindex="-1" aria-label="Drag to reorder">⠿</button>
      <div class="dot"></div>
      <div class="qnum">${esc(c.number)}</div>
      <div class="type-ic ${t.cls}">${t.ic}</div>
      <div class="qname"><span class="nm">${esc(c.name)}</span><span class="sub">${esc(this._subText(c))}</span></div>
      <div class="qinfo">${esc(info)}</div>
      <div class="qdur">${dur}</div>
      <div class="flags">${this._flagsHtml(c)}</div>
      <button class="row-edit" tabindex="-1" aria-label="Edit cue">›</button>`;
    return row;
  }
  _renderRow(i) {
    const c = this.show.cues[i]; if (!c) return;
    const old = this.rows.get(c.id);
    if (!old) return this.render();          // index/identity drift — rebuild
    const row = this._makeRow(c, i);
    old.replaceWith(row);
    this.rows.set(c.id, row);
    this._markPlaying();
  }

  // Compact one-line summary shown under the name on mobile (detail columns hidden there).
  _subText(c) {
    if (c.type === 'audio') {
      const b = [c.fileName || 'audio', c.loop ? '∞ loop' : fmtTime(c.duration)];
      if (c.fadeIn > 0) b.push('↗' + c.fadeIn + 's');
      if (c.fadeOut > 0) b.push('↘' + c.fadeOut + 's');
      if (c.preWait > 0) b.push('⏱' + c.preWait + 's');
      if (c.autoContinue) b.push('⏎ auto');
      return b.join(' · ');
    }
    if (c.type === 'stop') {
      const t = c.target === 'all' ? 'Stop all cues' : 'Stop cue ' + (this.show.cueById(c.target)?.number ?? '?');
      return t + (c.fadeOut > 0 ? ' · ↘' + c.fadeOut + 's' : '');
    }
    return 'Wait' + (c.preWait > 0 ? ' ' + c.preWait + 's' : '') + (c.autoContinue ? ' · ⏎ auto' : '');
  }
  _flagsHtml(c) {
    const f = [];
    if (c.preWait > 0) f.push(`<span class="flag on">⏱${c.preWait}s</span>`);
    if (c.type === 'audio' && c.fadeIn > 0) f.push(`<span class="flag on">↗${c.fadeIn}s</span>`);
    if (c.fadeOut > 0) f.push(`<span class="flag on">↘${c.fadeOut}s</span>`);
    if (c.autoContinue) f.push(`<span class="flag on">⏎ auto</span>`);
    return f.join('');
  }

  // ---- live indicators ----
  _markCurrent() {
    const id = this.show.currentCue?.id;
    this.rows.forEach((el, cueId) => el.classList.toggle('current', cueId === id));
  }
  _markPlaying() {
    this.rows.forEach((el, cueId) => el.classList.toggle('playing', this.audio.isPlaying(cueId)));
  }
  _scrollIntoView() {
    this.rows.get(this.show.currentCue?.id)?.scrollIntoView({ block: 'nearest' });
  }

  // ---- selection + edit ----
  _wireClick() {
    this.root.addEventListener('click', e => {
      if (e.target.closest('.row-grip')) return;        // grip is for dragging, not selection
      const row = e.target.closest('.row'); if (!row) return;
      this.show.setCurrent(+row.dataset.i);
      if (e.target.closest('.row-edit')) this.onEdit(+row.dataset.i);
    });
  }

  // ---- drag reorder (Pointer Events: mouse + touch alike) ----
  _wirePointer() {
    const root = this.root;
    root.addEventListener('pointerdown', e => {
      const grip = e.target.closest('.row-grip'); if (!grip) return;
      const row = grip.closest('.row'); if (!row) return;
      e.preventDefault();
      this._drag = { from: +row.dataset.i, row, startY: e.clientY, before: +row.dataset.i };
      row.classList.add('dragging');
      root.setPointerCapture(e.pointerId);
      this._showIndicator(this._drag.before);
    });
    root.addEventListener('pointermove', e => {
      const d = this._drag; if (!d) return;
      e.preventDefault();
      d.row.style.transform = `translateY(${e.clientY - d.startY}px)`;   // row follows the finger
      d.before = this._beforeIndexAt(e.clientY);
      this._showIndicator(d.before);
      this._autoScroll(e.clientY);
    });
    const end = () => {
      const d = this._drag; if (!d) return;
      this._drag = null;
      d.row.style.transform = ''; d.row.classList.remove('dragging');
      this._clearIndicators();
      const to = d.before > d.from ? d.before - 1 : d.before;   // account for the gap left by removal
      this.show.move(d.from, to);                                // no-op if to === from
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }
  _beforeIndexAt(y) {                  // insertion slot 0..n for a clientY
    const rows = [...this.rows.values()];
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) return k;
    }
    return rows.length;
  }
  _clearIndicators() {
    this.root.querySelectorAll('.dragover-top,.dragover-bot')
      .forEach(r => r.classList.remove('dragover-top', 'dragover-bot'));
  }
  _showIndicator(before) {
    this._clearIndicators();
    const rows = [...this.rows.values()]; if (!rows.length) return;
    if (before >= rows.length) rows[rows.length - 1].classList.add('dragover-bot');
    else rows[before].classList.add('dragover-top');
  }
  _autoScroll(y) {
    const r = this.root.getBoundingClientRect(), pad = 48;
    if (y < r.top + pad) this.root.scrollTop -= 9;
    else if (y > r.bottom - pad) this.root.scrollTop += 9;
  }
}
