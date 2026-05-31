// Pure, dependency-free helpers shared across modules. No DOM, no state.

export const clamp01 = v => Math.max(0, Math.min(1, v));

/** Seconds → "m:ss" (negatives and non-finite clamp to 0:00). */
export const fmtTime = s => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/** Linear amplitude (0..1) → signed dB label, e.g. "−6.0 dB" or "−∞ dB". */
export const dbLabel = a => {
  if (a <= 0) return '−∞ dB';
  const db = 20 * Math.log10(a);
  return `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
};

/** Escape a string for safe interpolation into innerHTML. */
export const escapeHtml = s =>
  String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

let counter = 0;
/** Collision-resistant short id for cues. */
export const uid = () => 'c' + (counter++).toString(36) + Math.floor(performance.now()).toString(36);

/**
 * Minimal typed event emitter. Subclasses (or owners) call emit(type, payload);
 * listeners subscribe with on(type, fn) and receive payload. on() returns an
 * unsubscribe function. This is the seam that keeps views loosely coupled from
 * the model — a new view only needs to subscribe, never to be wired in.
 */
export class Emitter {
  #subs = new Map();
  on(type, fn) {
    let set = this.#subs.get(type);
    if (!set) this.#subs.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  emit(type, payload) {
    this.#subs.get(type)?.forEach(fn => fn(payload));
  }
}
