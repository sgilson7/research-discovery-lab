/* Research discovery lab.
 *
 * Every string a participant reads comes from data/stations.json, so changing
 * the lab is a data edit rather than a code edit. The page decides three
 * things: which links can be built from the details typed in, what state each
 * task is in, and what the summary says.
 *
 * Nothing leaves the browser. The details and the task states live in
 * localStorage, and the page's Content-Security-Policy sets connect-src to
 * 'self', so there is no route to another origin even by mistake.
 */

const KEY_DETAILS = 'rdl.details.v1';
const KEY_STATE = 'rdl.state.v1';

const $ = (id) => document.getElementById(id);

/** localStorage can throw (private window, blocked site data), and a lab that
 *  dies because it cannot remember a field is worse than one that forgets. */
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

let DATA = null;
let details = load(KEY_DETAILS, {});
let state = load(KEY_STATE, {}); // taskId -> 'done' | 'skipped'
let collapsed = false; // the details form is never collapsed while someone types

/** ORCID and the id fields are pasted, often as a whole URL. Take the id out of
 *  whatever was pasted rather than telling someone they typed it wrong. */
function clean(fieldId, raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (fieldId === 'orcid') {
    const m = v.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
    return m ? m[1].toUpperCase() : v;
  }
  if (fieldId === 'scholar') {
    const m = v.match(/[?&]user=([^&#]+)/);
    return m ? m[1] : v;
  }
  if (fieldId === 's2') {
    const m = v.match(/semanticscholar\.org\/author\/(?:[^/]*\/)?(\d+)/);
    return m ? m[1] : v;
  }
  if (fieldId === 'openalex') {
    const m = v.match(/(A\d+)/i);
    return m ? m[1].toUpperCase() : v;
  }
  if (fieldId === 'site') return v.replace(/\/+$/, '');
  return v;
}

function has(id) {
  return !!(details[id] && String(details[id]).trim());
}

/** Fill {token} holes from the details. Values are percent-encoded unless the
 *  field is a URL being used as a prefix, which must stay a URL. */
function fill(tpl) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = details[k] || '';
    return k === 'site' ? v : encodeURIComponent(v);
  });
}

/** A link is live when every field it needs is present; otherwise it falls back
 *  to something that still helps (a search, a sign-in), and says so. */
function resolveLink(link) {
  const needs = link.needs || [];
  if (link.href) return { label: link.label, href: link.href, ready: true };
  if (needs.every(has)) return { label: link.label, href: fill(link.tpl), ready: true };
  if (link.fallback) {
    const fNeeds = link.fallbackNeeds || [];
    if (fNeeds.every(has)) {
      return { label: link.fallbackLabel || link.label, href: fill(link.fallback), ready: true };
    }
    if (fNeeds.length === 0) {
      return { label: link.fallbackLabel || link.label, href: link.fallback, ready: true };
    }
  }
  const missing = needs.filter((n) => !has(n));
  return { label: link.label, href: null, ready: false, missing };
}

function labelFor(fieldId) {
  const f = (DATA.fields || []).find((x) => x.id === fieldId);
  return f ? f.label : fieldId;
}

/** Per-station counts. The diagram and the summary both read this, so there is
 *  one definition of what "resolved" means: a task is resolved when it has been
 *  done or deliberately skipped. */
function stationProgress(station) {
  const total = station.tasks.length;
  let done = 0;
  let skipped = 0;
  for (const t of station.tasks) {
    if (state[t.id] === 'done') done += 1;
    else if (state[t.id] === 'skipped') skipped += 1;
  }
  const resolved = done + skipped;
  return { total, done, skipped, remaining: total - resolved, resolved, complete: resolved === total };
}

/** The first station with a task still to do, or null when the route is done.
 *  This is what the NEXT marker and the summary's "Next:" line both use. */
function nextStation() {
  return DATA.stations.find((s) => stationProgress(s).remaining > 0) || null;
}

function nextTask() {
  const s = nextStation();
  if (!s) return null;
  const t = s.tasks.find((t) => !state[t.id]);
  return t ? { station: s, task: t } : null;
}

function allTasks() {
  return DATA.stations.flatMap((s) => s.tasks.map((t) => ({ station: s, task: t })));
}

/** The compact line shown when the form is collapsed, and above it when open. */
function detailsSummary() {
  const filled = DATA.fields.filter((f) => has(f.id));
  if (!filled.length) return '';
  return filled.map((f) => f.label + ': ' + details[f.id]).join(' · ');
}

function renderDetailsSummary() {
  const line = $('details-summary');
  const toggle = $('details-toggle');
  const text = detailsSummary();
  line.textContent = text;
  line.hidden = !text;
  toggle.hidden = !text;
  toggle.textContent = collapsed ? 'Edit my details' : 'Hide details';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  $('fields').hidden = collapsed;
  $('details-actions').hidden = collapsed;
}

function renderFields() {
  const wrap = $('fields');
  wrap.textContent = '';
  const groups = DATA.fieldGroups || [{ name: '', fields: DATA.fields.map((f) => f.id) }];
  for (const g of groups) {
    const box = document.createElement('div');
    box.className = 'fieldgroup';
    if (g.name) {
      const h = document.createElement('h3');
      h.textContent = g.name;
      box.append(h);
    }
    const inner = document.createElement('div');
    inner.className = 'fieldgrid';
    box.append(inner);
    wrap.append(box);
    g._inner = inner;
  }
  const where = (id) => {
    const g = groups.find((x) => x.fields.includes(id));
    return (g || groups[0])._inner;
  };
  for (const f of DATA.fields) {
    const d = document.createElement('div');
    d.className = 'field';
    const label = document.createElement('label');
    label.htmlFor = 'f-' + f.id;
    label.textContent = f.label;
    const input = document.createElement('input');
    input.id = 'f-' + f.id;
    input.type = 'text';
    input.placeholder = f.placeholder || '';
    input.value = details[f.id] || '';
    input.addEventListener('input', () => {
      details[f.id] = clean(f.id, input.value);
      save(KEY_DETAILS, details);
      flash($('saved'), 'Saved in this browser');
      renderStations();
      renderDetailsSummary();
    });
    input.addEventListener('blur', () => { input.value = details[f.id] || ''; });
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = f.hint || '';
    d.append(label, input, hint);
    where(f.id).append(d);
  }
}

function flash(el, text) {
  if (!el) return;
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 1800);
}

function setState(id, value) {
  if (state[id] === value) delete state[id];
  else state[id] = value;
  save(KEY_STATE, state);
  renderStations();
  renderProgress();
}

function renderStations() {
  const root = $('stations');
  root.textContent = '';
  for (const s of DATA.stations) {
    const sec = document.createElement('section');
    sec.className = 'station';
    sec.id = 'station-' + s.id;

    sec.tabIndex = -1;
    const idx = DATA.stations.indexOf(s) + 1;
    const head = document.createElement('header');
    const h = document.createElement('h2');
    const n = document.createElement('span');
    n.className = 'stnum';
    n.textContent = String(idx);
    h.append(n, document.createTextNode(s.name));
    const sl = document.createElement('p');
    sl.className = 'connection';
    sl.textContent = s.connection || '';
    head.append(h, sl);
    sec.append(head);

    const intro = document.createElement('p');
    intro.className = 'intro';
    intro.textContent = s.intro;
    sec.append(intro);

    const skipAll = document.createElement('p');
    skipAll.className = 'skipall';
    const sb = document.createElement('button');
    sb.type = 'button';
    const allSkipped = s.tasks.every((t) => state[t.id] === 'skipped');
    sb.textContent = allSkipped ? 'Restore station' : 'Skip station';
    sb.addEventListener('click', () => {
      for (const t of s.tasks) {
        if (allSkipped) delete state[t.id];
        else if (state[t.id] !== 'done') state[t.id] = 'skipped';
      }
      save(KEY_STATE, state);
      renderStations();
      renderProgress();
    });
    skipAll.append(sb);
    sec.append(skipAll);

    for (const t of s.tasks) sec.append(renderTask(t));
    root.append(sec);
  }
}

function renderTask(t) {
  const el = document.createElement('article');
  el.className = 'task' + (state[t.id] ? ' ' + state[t.id] : '');

  const state_ = document.createElement('div');
  state_.className = 'state';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'c-' + t.id;
  box.checked = state[t.id] === 'done';
  box.addEventListener('change', () => setState(t.id, 'done'));
  state_.append(box);

  const h = document.createElement('h3');
  const lab = document.createElement('label');
  lab.htmlFor = 'c-' + t.id;
  lab.textContent = t.title;
  h.append(lab);

  const body = document.createElement('p');
  body.className = 'body';
  body.textContent = t.body;

  el.append(state_, h);
  if (state[t.id]) {
    const badge = document.createElement('p');
    badge.className = 'badge ' + state[t.id];
    badge.textContent = state[t.id] === 'done' ? '\u2713 Done' : 'Skipped';
    el.append(badge);
  }
  el.append(body);

  if (t.prompt) {
    const text = fill(t.prompt);
    const p = document.createElement('pre');
    p.className = 'prompt';
    p.textContent = text;
    const row = document.createElement('p');
    row.className = 'promptrow';
    const cp = document.createElement('button');
    cp.type = 'button';
    cp.className = 'small';
    cp.textContent = 'Copy prompt';
    const said = document.createElement('span');
    said.className = 'saved';
    cp.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        flash(said, 'Copied');
      } catch (_) {
        window.prompt('Copy this prompt', text);
      }
    });
    row.append(cp, said);
    el.append(p, row);
  }

  if (t.links && t.links.length) {
    // Two roles. A link to the participant's own record is the task's action; a
    // vendor or help page is reference. Mixing them made everything read as
    // equally urgent.
    const primary = t.links.filter((l) => l.kind !== 'reference');
    const reference = t.links.filter((l) => l.kind === 'reference');

    if (primary.length) {
      const ul = document.createElement('ul');
      ul.className = 'links primary';
      for (const link of primary) ul.append(linkItem(link));
      el.append(ul);
    }
    if (reference.length) {
      const wrap = document.createElement('div');
      wrap.className = 'refwrap';
      const lab = document.createElement('span');
      lab.className = 'reflabel';
      lab.textContent = 'Reference';
      const ul = document.createElement('ul');
      ul.className = 'links reference';
      for (const link of reference) ul.append(linkItem(link));
      wrap.append(lab, ul);
      el.append(wrap);
    }
  }

  const btns = document.createElement('div');
  btns.className = 'rowbtns';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.textContent = state[t.id] === 'skipped' ? 'Restore' : 'Skip for now';
  skip.addEventListener('click', () => setState(t.id, 'skipped'));
  btns.append(skip);
  el.append(btns);
  return el;
}

/** The route: one node per station, in talk order, filling in as the lab is
 *  worked through. State is carried by the count, the strip, the tick and the
 *  NEXT label as well as by colour, because colour is never the only cue. */
function renderRoute() {
  const root = $('route');
  root.textContent = '';
  const next = nextStation();
  DATA.stations.forEach((s, i) => {
    const p = stationProgress(s);
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'node' + (p.complete ? ' complete' : '') + (next && next.id === s.id ? ' next' : '');
    node.dataset.station = s.id;

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);

    const lab = document.createElement('span');
    lab.className = 'lab';
    lab.textContent = s.short || s.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = p.complete ? '\u2713 ' + p.resolved + '/' + p.total : p.resolved + '/' + p.total;

    const strip = document.createElement('span');
    strip.className = 'strip';
    strip.setAttribute('aria-hidden', 'true');
    for (const t of s.tasks) {
      const seg = document.createElement('span');
      const st = state[t.id];
      seg.className = 'seg ' + (st === 'done' ? 'd' : st === 'skipped' ? 's' : 'r');
      strip.append(seg);
    }

    node.append(num, lab, count, strip);
    if (next && next.id === s.id) {
      const tag = document.createElement('span');
      tag.className = 'nexttag';
      tag.textContent = 'NEXT';
      node.append(tag);
    }
    node.setAttribute(
      'aria-label',
      'Station ' + (i + 1) + ', ' + s.name + '. ' +
        p.done + ' completed, ' + p.skipped + ' skipped, ' + p.remaining + ' remaining' +
        (next && next.id === s.id ? '. Next station.' : p.complete ? '. Complete.' : '.')
    );
    node.addEventListener('click', () => {
      const el = document.getElementById('station-' + s.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.focus({ preventScroll: true });
      }
    });

    const li = document.createElement('li');
    li.className = 'routeitem';
    li.append(node);
    root.append(li);
  });
}

/** One link. A link whose field is missing keeps its normal label and says what
 *  to add underneath, so the label stays scannable. */
function linkItem(link) {
  const r = resolveLink(link);
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.textContent = r.label;
  if (r.ready) {
    a.href = r.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.append(a);
  } else {
    a.className = 'needs';
    a.href = '#details-panel';
    li.append(a);
    const note = document.createElement('span');
    note.className = 'needsnote';
    const names = r.missing.map(labelFor).join(' and ');
    note.textContent = 'Add your ' + names + ' above to personalize this link.';
    li.append(note);
  }
  return li;
}

function renderProgress() {
  const all = allTasks();
  const done = all.filter(({ task }) => state[task.id] === 'done').length;
  const skipped = all.filter(({ task }) => state[task.id] === 'skipped').length;
  const total = all.length;
  const resolved = done + skipped;
  $('progress-text').textContent =
    resolved + ' of ' + total + ' steps resolved \u00b7 ' + done + ' completed \u00b7 ' +
    skipped + ' skipped \u00b7 ' + (total - resolved) + ' remaining';
  const next = nextStation();
  $('progress-next').textContent = next
    ? 'Next: ' + next.name
    : 'Lab route complete. Your summary is ready below.';
  renderRoute();
}

/** The copied text. It deliberately carries NO profile identifiers: those stay
 *  in the browser, and a next-steps list is something a participant may paste
 *  into a shared document. */
function summary() {
  const all = allTasks();
  const total = all.length;
  const done = all.filter(({ task }) => state[task.id] === 'done').length;
  const skipped = all.filter(({ task }) => state[task.id] === 'skipped').length;
  const nt = nextTask();
  const lines = [
    'Research discovery lab \u2014 ' + new Date().toISOString().slice(0, 10),
    (done + skipped) + ' of ' + total + ' steps resolved (' + done + ' completed, ' + skipped + ' skipped)',
    nt ? 'Next: ' + nt.task.title : 'Next: nothing left — the route is complete.',
    '',
  ];
  for (const st of DATA.stations) {
    const p = stationProgress(st);
    lines.push(st.name + ' \u2014 ' + p.done + ' completed, ' + p.skipped + ' skipped, ' + p.remaining + ' remaining');
    for (const t of st.tasks) {
      if (!state[t.id]) lines.push('  - ' + t.title);
    }
  }
  return lines.join('\n');
}

function renderDiscussion() {
  const d = DATA.discussion;
  if (!d) return;
  const wrap = $('discussion-wrap');
  wrap.textContent = '';
  const h = document.createElement('h2');
  h.id = 'disc-h';
  h.textContent = d.name;
  const ul = document.createElement('ul');
  for (const item of d.items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  wrap.append(h, ul);
}

async function main() {
  const res = await fetch('data/stations.json');
  DATA = await res.json();
  document.title = DATA.title;
  $('title').textContent = DATA.title;
  $('subtitle').textContent = DATA.subtitle;
  $('permission').textContent = DATA.permission;
  $('details-note').textContent = DATA.detailsNote || '';
  collapsed = false;
  renderFields();
  renderDetailsSummary();
  renderStations();
  renderProgress();
  renderDiscussion();

  $('details-toggle').addEventListener('click', () => {
    collapsed = !collapsed;
    renderDetailsSummary();
  });

  $('clear').addEventListener('click', () => {
    details = {};
    save(KEY_DETAILS, details);
    renderFields();
    renderDetailsSummary();
    renderStations();
    flash($('saved'), 'Cleared');
  });

  $('copy').addEventListener('click', async () => {
    const text = summary();
    try {
      await navigator.clipboard.writeText(text);
      flash($('copied'), 'Copied');
    } catch (_) {
      // Clipboard access can be refused; showing the text is still useful.
      window.prompt('Copy your summary', text);
    }
  });
}

main();

// Exposed so the browser check can exercise the station-level progress maths
// and the next-station choice without driving the whole page.
window.__rdl = {
  stationProgress: (id) => stationProgress(DATA.stations.find((s) => s.id === id)),
  nextStationId: () => (nextStation() ? nextStation().id : null),
  setState: (taskId, value) => { state[taskId] = value; save(KEY_STATE, state); renderStations(); renderProgress(); },
  clearState: () => { state = {}; save(KEY_STATE, state); renderStations(); renderProgress(); },
  summary,
};
