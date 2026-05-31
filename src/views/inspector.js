import { clamp01, dbLabel, escapeHtml as esc } from '../util.js';

/**
 * Property editor for the standby cue. Edits flow out as show.update(i, patch);
 * structural buttons call show.move/duplicate/remove. It re-renders when the
 * selection changes, but deliberately ignores 'cueChanged' (its own edits) so a
 * field keeps focus while you type. A type change re-renders locally to swap
 * the type-specific fields.
 */
export class Inspector {
  constructor(root, show) {
    this.root = root;
    this.show = show;
    this._shownId = null;

    show.on('current', () => this.render());
    // On structural change, re-render only if the displayed cue changed (e.g. it
    // was deleted) — avoids stomping focus when an unrelated cue is added.
    show.on('cues', () => { if ((show.currentCue?.id ?? null) !== this._shownId) this.render(); });

    this.render();
  }

  render() {
    const show = this.show, c = show.currentCue;
    this._shownId = c?.id ?? null;
    if (!c) { this.root.innerHTML = `<div class="insp-empty">Select a cue to edit its properties.</div>`; return; }

    const audioFields = `
      <div class="field"><label>Volume</label>
        <div class="row-flex vol-row">
          <input type="range" id="f-volume" min="0" max="100" value="${Math.round(c.volume * 100)}">
          <span class="vol-db" id="volDb">${dbLabel(c.volume)}</span></div></div>
      <div class="grid2">
        <div class="field"><label>Fade In (s)</label><input type="number" id="f-fadeIn" min="0" step="0.1" value="${c.fadeIn}"></div>
        <div class="field"><label>Fade Out (s)</label><input type="number" id="f-fadeOut" min="0" step="0.1" value="${c.fadeOut}"></div>
      </div>
      <label class="chk"><input type="checkbox" id="f-loop" ${c.loop ? 'checked' : ''}> Loop</label>`;

    const stopFields = `
      <div class="field"><label>Target</label>
        <select id="f-target">
          <option value="all" ${c.target === 'all' ? 'selected' : ''}>All cues</option>
          ${show.cues.filter(x => x.type === 'audio').map(x =>
            `<option value="${x.id}" ${c.target === x.id ? 'selected' : ''}>Cue ${esc(x.number)} — ${esc(x.name)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Fade Out (s)</label><input type="number" id="f-fadeOut" min="0" step="0.1" value="${c.fadeOut}"></div>`;

    this.root.innerHTML = `
      <div class="grid2">
        <div class="field"><label>Number</label><input type="text" id="f-number" value="${esc(c.number)}"></div>
        <div class="field"><label>Type</label>
          <select id="f-type">
            <option value="audio" ${c.type === 'audio' ? 'selected' : ''}>Audio</option>
            <option value="stop"  ${c.type === 'stop' ? 'selected' : ''}>Stop / Fade</option>
            <option value="wait"  ${c.type === 'wait' ? 'selected' : ''}>Wait</option>
          </select></div>
      </div>
      <div class="field"><label>Name</label><input type="text" id="f-name" value="${esc(c.name)}"></div>
      ${c.type === 'audio' ? audioFields : c.type === 'stop' ? stopFields : ''}
      <div class="field"><label>Pre-wait before firing (s)</label><input type="number" id="f-preWait" min="0" step="0.1" value="${c.preWait}"></div>
      <label class="chk"><input type="checkbox" id="f-autoContinue" ${c.autoContinue ? 'checked' : ''}> Auto-continue (fire next cue too)</label>
      <div class="insp-actions">
        <button id="i-up">↑ Up</button>
        <button id="i-down">↓ Down</button>
        <button id="i-dup">Duplicate</button>
        <button id="i-del" class="del">Delete</button>
      </div>`;

    this._bindFields();
  }

  _bindFields() {
    const show = this.show;
    const $ = id => this.root.querySelector('#' + id);
    // bind one field: parse(el) -> patch value for `key`
    const bind = (id, key, parse) => {
      const el = $(id); if (!el) return;
      const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, () => {
        show.update(show.current, { [key]: parse(el) });
        if (id === 'f-volume') $('volDb').textContent = dbLabel(show.currentCue.volume);
        if (id === 'f-type') this.render();      // swap the type-specific fields
      });
    };
    bind('f-number', 'number', e => e.value);
    bind('f-name', 'name', e => e.value);
    bind('f-type', 'type', e => e.value);
    bind('f-volume', 'volume', e => clamp01(e.value / 100));
    bind('f-fadeIn', 'fadeIn', e => Math.max(0, +e.value || 0));
    bind('f-fadeOut', 'fadeOut', e => Math.max(0, +e.value || 0));
    bind('f-preWait', 'preWait', e => Math.max(0, +e.value || 0));
    bind('f-loop', 'loop', e => e.checked);
    bind('f-autoContinue', 'autoContinue', e => e.checked);
    bind('f-target', 'target', e => e.value);

    $('i-up').onclick = () => show.move(show.current, show.current - 1);
    $('i-down').onclick = () => show.move(show.current, show.current + 1);
    $('i-dup').onclick = () => show.duplicate(show.current);
    $('i-del').onclick = () => show.remove(show.current);
  }
}
