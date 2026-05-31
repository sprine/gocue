import { AudioEngine } from './audio.js';
import { Store } from './store.js';
import { Show } from './show.js';
import { CueList } from './views/cue-list.js';
import { Inspector } from './views/inspector.js';
import { Monitor } from './views/monitor.js';
import { Transport } from './views/transport.js';

// Composition root: build the deep modules, hand them to the views, then load.
// Adding a feature is usually a new module that subscribes to `show`/`audio`
// here — no existing module needs to change.
const $ = s => document.querySelector(s);

async function main() {
  const audio = new AudioEngine();
  const store = await Store.open();          // always resolves (NullStore if no IndexedDB)
  const show = new Show(audio, store);

  // Mobile bottom sheet (inspector + monitor). Shared open/close used by both
  // the cue list's edit affordance and the transport's panels/close buttons.
  const sheetEl = $('aside'), backEl = $('#sheetBack');
  const sheet = {
    open() { sheetEl.classList.add('open'); backEl.classList.add('show'); },
    close() { sheetEl.classList.remove('open'); backEl.classList.remove('show'); },
  };
  backEl.onclick = () => sheet.close();

  new CueList($('#list'), show, audio, { onEdit: () => sheet.open() });
  new Inspector($('#inspector'), show);
  new Monitor($('#monitor'), audio, {
    onCount(n) {
      $('#monCount').textContent = n ? `(${n})` : '';
      $('#panels').textContent = n ? `▤ ${n}` : '▤';
    },
  });
  new Transport(show, audio, {
    go: $('#go'), mGo: $('#mGo'), stop: $('#stopAll'), mStop: $('#mStop'),
    pause: $('#pause'), mPause: $('#mPause'), master: $('#master'), masterDb: $('#masterDb'),
    status: $('#status'), saveDot: $('#saveDot'), add: $('#add'), filePick: $('#filePick'),
    menu: $('#menu'), panels: $('#panels'), sheetClose: $('#sheetClose'), veil: $('#dropVeil'),
  }, sheet);

  await show.hydrate();                       // emits 'cues'/'current'/'master'/'saved' → views render
}

main();
