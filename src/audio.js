import { clamp01, Emitter } from './util.js';

/**
 * Owns the Web Audio graph and every playing voice. Callers deal only in cues
 * and playback ids (pids); all scheduling, fading, and node teardown is hidden.
 *
 * Interface:
 *   decode(arrayBuffer) -> Promise<AudioBuffer>
 *   play(cue) -> pid           start a voice for an audio cue
 *   stopPid(pid, fade)         stop one voice
 *   stopByCue(cueId, fade)     stop all voices of a cue
 *   stopAll(fade)              stop everything
 *   setMaster(amp) / setPaused(bool)
 *   isPlaying(cueId) -> bool
 *   playbacks() -> [{pid,cueId,num,name,loop,duration,elapsed,position,remaining,fading}]
 * Emits 'change' whenever the set of playing voices changes.
 */
export class AudioEngine extends Emitter {
  constructor() {
    super();
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this._voices = new Map();   // pid -> internal record (gain/source kept private)
    this._pid = 0;
  }

  resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
  setPaused(p) { p ? this.ctx.suspend() : this.ctx.resume(); }
  setMaster(amp) {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(clamp01(amp), t, 0.015);
  }
  decode(arrayBuffer) { return this.ctx.decodeAudioData(arrayBuffer); }

  play(cue) {
    if (!cue.buffer) return;
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime, vol = clamp01(cue.volume);
    const src = ctx.createBufferSource();
    src.buffer = cue.buffer; src.loop = !!cue.loop;
    const g = ctx.createGain();
    src.connect(g).connect(this.master);

    if (cue.fadeIn > 0) {                       // fade in
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), now + cue.fadeIn);
    } else g.gain.setValueAtTime(vol, now);

    const dur = cue.buffer.duration;
    let fadeOutAt = Infinity;
    if (!cue.loop && cue.fadeOut > 0 && dur > cue.fadeOut) {   // fade out at natural end
      fadeOutAt = now + dur - cue.fadeOut;
      g.gain.setValueAtTime(vol, fadeOutAt);
      g.gain.linearRampToValueAtTime(0.0001, fadeOutAt + cue.fadeOut);
    }
    src.start(now);

    const pid = ++this._pid;
    const rec = { pid, cueId: cue.id, name: cue.name, num: cue.number,
                  src, gain: g, startTime: now, duration: dur, loop: !!cue.loop, fadeOutAt, stopping: false };
    src.onended = () => { if (this._voices.get(pid) === rec) { this._voices.delete(pid); this.emit('change'); } };
    this._voices.set(pid, rec);
    this.emit('change');
    return pid;
  }

  stopPid(pid, fade = 0) { const r = this._voices.get(pid); if (r) this._fadeStop(r, fade); this.emit('change'); }
  stopByCue(cueId, fade = 0) { for (const r of [...this._voices.values()]) if (r.cueId === cueId) this._fadeStop(r, fade); this.emit('change'); }
  stopAll(fade = 0) { for (const r of [...this._voices.values()]) this._fadeStop(r, fade); this.emit('change'); }

  isPlaying(cueId) { for (const r of this._voices.values()) if (r.cueId === cueId && !r.stopping) return true; return false; }

  /** Snapshot of every live voice with progress computed against the audio clock. */
  playbacks() {
    const now = this.ctx.currentTime, out = [];
    for (const r of this._voices.values()) {
      const raw = now - r.startTime;
      const pos = r.duration ? (r.loop ? (raw % r.duration) / r.duration : Math.min(1, raw / r.duration)) : 0;
      out.push({
        pid: r.pid, cueId: r.cueId, num: r.num, name: r.name, loop: r.loop,
        duration: r.duration,
        elapsed: r.loop && r.duration ? raw % r.duration : raw,
        position: pos,
        remaining: Math.max(0, r.duration - raw),
        fading: now >= r.fadeOutAt,
      });
    }
    return out;
  }

  // ---- internals ----
  _kill(rec) {                                   // immediate, authoritative teardown
    try { rec.src.onended = null; rec.src.stop(); } catch {}
    try { rec.gain.disconnect(); } catch {}
    this._voices.delete(rec.pid);
  }
  _fadeStop(rec, fade) {
    if (rec.stopping) return;
    if (fade <= 0) { this._kill(rec); return; }  // hard stop: drop now, don't wait on onended
    this.resume();                               // a stalled clock would never finish the ramp
    const now = this.ctx.currentTime, g = rec.gain.gain;
    rec.stopping = true; rec.fadeOutAt = now;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.linearRampToValueAtTime(0.0001, now + fade);
    rec.src.stop(now + fade);
    setTimeout(() => { if (this._voices.get(rec.pid) === rec) { this._kill(rec); this.emit('change'); } }, fade * 1000 + 120);
  }
}
