import { dbLabel, escapeHtml as esc } from '../util.js';

/**
 * Binds the global controls (header + mobile thumb bar), keyboard shortcuts,
 * file-drop, the overflow menu, and the mobile sheet toggle to the show. It
 * forwards user intent into show.* and reflects show events back into the
 * chrome (status text, master readout, pause buttons, save indicator). `dom`
 * is the map of elements; `sheet` is { open, close }.
 */
export class Transport {
  constructor(show, audio, dom, sheet) {
    this.show = show;
    this.audio = audio;
    this.dom = dom;
    this.sheet = sheet;

    this._wireControls();
    this._wireKeyboard();
    this._wireFileDrop();

    show.on('current', () => this._refreshStatus());
    show.on('cues', () => this._refreshStatus());
    show.on('master', () => this._refreshMaster());
    show.on('paused', () => this._refreshPaused());
    show.on('saving', () => this._setSave('dirty'));
    show.on('saved', () => this._setSave('saved'));

    this._refreshStatus(); this._refreshMaster(); this._refreshPaused();
  }

  _wireControls() {
    const { dom, show, sheet } = this;
    const fire = e => { e.currentTarget.blur(); show.go(); };   // blur so Space won't double-trigger
    dom.go.onclick = fire;
    dom.mGo.onclick = fire;
    dom.stop.onclick = dom.mStop.onclick = () => show.stopAll(0);
    dom.pause.onclick = dom.mPause.onclick = () => show.togglePause();

    dom.master.oninput = () => show.setMaster(dom.master.value / 100);

    dom.add.onclick = () => dom.filePick.click();
    dom.filePick.onchange = e => { show.addFiles(e.target.files); e.target.value = ''; };

    dom.panels.onclick = () => sheet.open();
    dom.sheetClose.onclick = () => sheet.close();

    dom.menu.onclick = () => {
      const choice = prompt('Type a command:\n  stop   — add a Stop/Fade cue\n  wait   — add a Wait cue\n  renumber — renumber all cues 1..n\n  clear  — delete the whole show');
      if (choice === 'stop') show.addStop();
      else if (choice === 'wait') show.addWait();
      else if (choice === 'renumber') show.renumber();
      else if (choice === 'clear' && confirm('Delete every cue?')) show.clear();
    };
  }

  _wireKeyboard() {
    const show = this.show;
    window.addEventListener('keydown', e => {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
      if (e.code === 'Space' && !typing) { e.preventDefault(); show.go(); }
      else if (e.key === 'Escape') { e.preventDefault(); show.stopAll(0); if (typing) document.activeElement.blur(); }
      else if (e.key === 'ArrowDown' && !typing) { e.preventDefault(); show.setCurrent(show.current + 1); }
      else if (e.key === 'ArrowUp' && !typing) { e.preventDefault(); show.setCurrent(show.current - 1); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) { e.preventDefault(); show.remove(show.current); }
      else if ((e.key === 'p' || e.key === 'P') && !typing) show.togglePause();
    });
  }

  _wireFileDrop() {
    const veil = this.dom.veil, show = this.show;
    let depth = 0;
    window.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { depth++; veil.classList.add('show'); } });
    window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; veil.classList.remove('show'); } });
    window.addEventListener('drop', e => {
      if (e.dataTransfer?.files?.length) { e.preventDefault(); depth = 0; veil.classList.remove('show'); show.addFiles(e.dataTransfer.files); }
    });
  }

  // ---- reflect model state into the chrome ----
  _refreshStatus() {
    const { show, dom } = this, c = show.currentCue;
    dom.status.innerHTML = !show.cues.length ? 'No cues'
      : c ? `Standby → <b>${esc(c.number)} ${esc(c.name)}</b>` : '<b>End of list</b>';
    dom.go.disabled = dom.mGo.disabled = !c;
  }
  _refreshMaster() {
    this.dom.master.value = Math.round(this.show.master * 100);
    this.dom.masterDb.textContent = dbLabel(this.show.master);
  }
  _refreshPaused() {
    const p = this.show.paused;
    this.dom.pause.classList.toggle('paused', p);
    this.dom.pause.innerHTML = p ? '▶ Resume' : '❙❙ Pause';
    this.dom.mPause.classList.toggle('paused', p);
    this.dom.mPause.textContent = p ? '▶' : '❙❙';
  }
  _setSave(stateName) { this.dom.saveDot.className = 'save-dot ' + stateName; }
}
