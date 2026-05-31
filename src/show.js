import { Emitter, uid, clamp01 } from './util.js';

const AUDIO_EXT = /\.(wav|mp3|aif|aiff|m4a|ogg|flac)$/i;

/**
 * The show: an ordered list of cues plus a standby playhead, master level, and
 * pause state. This is the single place that mutates show data, and it pulls
 * the surrounding complexity downward — every mutation also drives the audio
 * engine, persists through the store, and emits an event. Views read `cues` /
 * `current` and subscribe; they never touch audio or storage directly.
 *
 * Events:
 *   'cues'        structural change (add / remove / move / renumber / clear / load)
 *   'cueChanged'  {index, cue} — one cue edited in place
 *   'current'     playhead / selection moved
 *   'master'      master level changed
 *   'paused'      pause state toggled
 *   'saving' / 'saved'   debounced persistence status (for the save indicator)
 */
export class Show extends Emitter {
  constructor(audio, store) {
    super();
    this.audio = audio;
    this.store = store;
    this.cues = [];
    this.current = 0;        // standby index; may equal cues.length ("end of list")
    this.master = 0.8;
    this.paused = false;
    this._saveTimer = null;
  }

  // ---- queries ----
  get currentCue() { return this.cues[this.current] ?? null; }
  cueById(id) { return this.cues.find(c => c.id === id); }

  /** A blank cue of the given type; `extra` overrides defaults. */
  blankCue(type = 'audio', extra = {}) {
    return {
      id: uid(), number: String(this.cues.length + 1), name: 'Untitled', type,
      volume: 1, fadeIn: 0, fadeOut: 0, preWait: 0, loop: false, autoContinue: false,
      target: 'all', fileName: '', duration: 0, buffer: null, blob: null, ...extra,
    };
  }

  // ---- load persisted show ----
  async hydrate() {
    const { metas, blobs, app } = await this.store.loadAll();
    const order = app?.order || [];
    metas.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    for (const m of metas) {
      const cue = { ...this.blankCue(m.type), ...m, buffer: null, blob: null };
      const blob = blobs.get(cue.id);
      if (blob) {
        cue.blob = blob;
        try { cue.buffer = await this.audio.decode(await blob.arrayBuffer()); cue.duration = cue.buffer.duration; }
        catch {}
      }
      this.cues.push(cue);
    }
    this.current = Math.min(app?.current ?? 0, this.cues.length);
    if (app?.master != null) { this.master = app.master; this.audio.setMaster(app.master); }
    this.emit('cues'); this.emit('current'); this.emit('master'); this.emit('saved');
  }

  // ---- mutations (each persists + emits) ----
  async addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('audio') || AUDIO_EXT.test(f.name));
    for (const f of files) {
      const cue = this.blankCue('audio', { name: f.name.replace(/\.[^.]+$/, ''), fileName: f.name });
      this.cues.push(cue);
      try {
        cue.buffer = await this.audio.decode(await f.arrayBuffer());
        cue.blob = f; cue.duration = cue.buffer.duration;
        this.store.saveAudio(cue.id, f);
      } catch { cue.name = '⚠ ' + cue.name + ' (decode failed)'; }
      this.store.saveCue(cue);
      this.emit('cues'); this._markDirty();
    }
  }
  addStop() { return this._append(this.blankCue('stop', { name: 'Stop All', target: 'all', fadeOut: 2 })); }
  addWait() { return this._append(this.blankCue('wait', { name: 'Wait', preWait: 3, autoContinue: true })); }

  /** Apply a partial patch to cue i (used by the inspector). */
  update(i, patch) {
    const c = this.cues[i]; if (!c) return;
    Object.assign(c, patch);
    this.store.saveCue(c);
    this.emit('cueChanged', { index: i, cue: c });
    this._markDirty();
  }
  remove(i) {
    const c = this.cues[i]; if (!c) return;
    this.audio.stopByCue(c.id, 0);
    this.store.removeCue(c.id);
    this.cues.splice(i, 1);
    this.current = Math.min(this.current, this.cues.length);
    this.emit('cues'); this.emit('current'); this._markDirty();
  }
  duplicate(i) {
    const c = this.cues[i]; if (!c) return;
    const copy = { ...c, id: uid(), number: c.number + 'b' };
    this.cues.splice(i + 1, 0, copy);
    if (copy.blob) this.store.saveAudio(copy.id, copy.blob);
    this.store.saveCue(copy);
    this.current = i + 1;
    this.emit('cues'); this.emit('current'); this._markDirty();
  }
  move(from, to) {
    if (to < 0 || to >= this.cues.length || from === to) return;
    const [c] = this.cues.splice(from, 1);
    this.cues.splice(to, 0, c);
    this.current = to;
    this.emit('cues'); this.emit('current'); this._markDirty();
  }
  renumber() {
    this.cues.forEach((c, i) => { c.number = String(i + 1); this.store.saveCue(c); });
    this.emit('cues'); this._markDirty();
  }
  clear() {
    this.audio.stopAll(0); this.store.clear();
    this.cues = []; this.current = 0;
    this.emit('cues'); this.emit('current');
  }

  // ---- transport ----
  setCurrent(i) {
    this.current = Math.max(0, Math.min(i, this.cues.length));
    this.emit('current'); this._saveApp();
  }
  setMaster(amp) { this.master = clamp01(amp); this.audio.setMaster(this.master); this.emit('master'); this._markDirty(); }
  togglePause() { this.paused = !this.paused; this.audio.setPaused(this.paused); this.emit('paused'); }
  stopAll(fade = 0) { this.audio.stopAll(fade); }

  /** Fire the standby cue (and any auto-continue chain), then advance the playhead. */
  go() {
    this.audio.resume();
    let i = this.current;
    if (i < 0 || i >= this.cues.length) return;     // past end of list
    let last = i;
    while (true) {
      this._fire(last);
      if (this.cues[last].autoContinue && last + 1 < this.cues.length) last++;
      else break;
    }
    this.setCurrent(last + 1);                       // always advance, even if a cue errored
  }

  // ---- internals ----
  _append(cue) { this.cues.push(cue); this.store.saveCue(cue); this.emit('cues'); this._markDirty(); return cue; }

  // Firing must never block playhead advancement, so failures are isolated here.
  _fire(i) {
    const cue = this.cues[i]; if (!cue) return;
    const exec = () => this._execute(cue);
    try {
      if (cue.preWait > 0) setTimeout(() => { try { exec(); } catch (e) { console.error('cue', cue.number, e); } }, cue.preWait * 1000);
      else exec();
    } catch (e) { console.error('cue', cue.number, e); }
  }
  _execute(cue) {
    if (cue.type === 'audio') this.audio.play(cue);
    else if (cue.type === 'stop') {
      if (cue.target === 'all') this.audio.stopAll(cue.fadeOut);
      else this.audio.stopByCue(cue.target, cue.fadeOut);
    }
    // 'wait' is a no-op; it matters only via preWait + autoContinue sequencing
  }

  _appSnapshot() { return { current: this.current, master: this.master, order: this.cues.map(c => c.id) }; }
  _saveApp() { this.store.saveApp(this._appSnapshot()); }
  _markDirty() {
    this.emit('saving');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveApp(); this.emit('saved'); }, 500);
  }
}
