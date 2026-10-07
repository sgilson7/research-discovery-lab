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

function allTasks() {
  return DATA.stations.flatMap((s) => s.tasks.map((t) => ({ station: s, task: t })));
}

function renderFields() {
  const wrap = $('fields');
  wrap.textContent = '';
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
    });
    input.addEventListener('blur', () => { input.value = details[f.id] || ''; });
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = f.hint || '';
    d.append(label, input, hint);
    wrap.append(d);
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

    const head = document.createElement('header');
    const h = document.createElement('h2');
    h.textContent = s.name;
    const sl = document.createElement('p');
    sl.className = 'slides';
    sl.textContent = s.slides || '';
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
    sb.textContent = allSkipped ? 'Bring this station back' : 'Skip this whole station';
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

  el.append(state_, h, body);

  if (t.prompt) {
    const p = document.createElement('pre');
    p.className = 'prompt';
    p.textContent = fill(t.prompt);
    el.append(p);
  }

  if (t.links && t.links.length) {
    const ul = document.createElement('ul');
    ul.className = 'links';
    for (const link of t.links) {
      const r = resolveLink(link);
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.textContent = r.label;
      if (r.ready) {
        a.href = r.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else {
        a.className = 'needs';
        a.href = '#details-panel';
        const names = r.missing.map(labelFor).join(' and ');
        a.title = 'Add your ' + names + ' above to build this link';
        a.textContent = r.label + ' — add your ' + names;
      }
      li.append(a);
      ul.append(li);
    }
    el.append(ul);
  }

  const btns = document.createElement('div');
  btns.className = 'rowbtns';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.textContent = state[t.id] === 'skipped' ? 'Unskip' : 'Skip this';
  skip.addEventListener('click', () => setState(t.id, 'skipped'));
  btns.append(skip);
  el.append(btns);
  return el;
}

function renderProgress() {
  const all = allTasks();
  const done = all.filter(({ task }) => state[task.id] === 'done').length;
  const skipped = all.filter(({ task }) => state[task.id] === 'skipped').length;
  const total = all.length;
  $('bar-done').style.width = (done / total) * 100 + '%';
  $('bar-skip').style.width = (skipped / total) * 100 + '%';
  $('progress-text').textContent =
    done + ' of ' + total + ' done, ' + skipped + ' skipped, ' +
    (total - done - skipped) + ' left. Skipping is a finished answer too.';
}

function summary() {
  const lines = ['Research discovery lab — ' + new Date().toISOString().slice(0, 10), ''];
  for (const f of DATA.fields) {
    if (has(f.id)) lines.push(f.label + ': ' + details[f.id]);
  }
  lines.push('');
  for (const s of DATA.stations) {
    const done = s.tasks.filter((t) => state[t.id] === 'done');
    const left = s.tasks.filter((t) => !state[t.id]);
    lines.push(s.name + ' — ' + done.length + '/' + s.tasks.length + ' done');
    for (const t of left) lines.push('  still to do: ' + t.title);
  }
  return lines.join('\n');
}

function renderDiscussion() {
  const d = DATA.discussion;
  if (!d) return;
  const wrap = $('discussion-wrap');
  wrap.textContent = '';
  const h = document.createElement('strong');
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
  renderFields();
  renderStations();
  renderProgress();
  renderDiscussion();

  $('clear').addEventListener('click', () => {
    details = {};
    save(KEY_DETAILS, details);
    renderFields();
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
