import {D, TIER_ORDER, TIER_COLOR, tierOf, tierLabel, awardGlyph,
        awardValue, awardName, awardOptions, esc} from './data.js';
import {readState, writeState, apply, matchesAward} from './filters.js';

const el = id => document.getElementById(id);
const num = n => n.toLocaleString();
const cssVar = k => getComputedStyle(document.body).getPropertyValue(k).trim() || '#888';
const tierColor = t => cssVar(TIER_COLOR[t].slice(4, -1));

/** Rows the dropdowns describe: everything, or one competition's awards.
 *  Options come from the competition alone, never from the other filters, so
 *  picking a year can never empty the award list and strand you. */
const scopeOf = st => st.comp ? D.rows.filter(r => r.comp.id === st.comp) : D.rows;

/** Tiers present in `rows`, ranked, with the label each one should carry. */
const tiersIn = rows => TIER_ORDER.filter(t => rows.some(r => tierOf(r) === t))
  .map(t => ({id: t, label: tierLabel(t, rows)}));

/** The competitions represented in `rows`, in the canonical order. */
const compsIn = rows => {
  const ids = new Set(rows.map(r => r.comp.id));
  return D.dims.competitions.filter(c => ids.has(c.id));
};

function filterBar(st, {style = true, search = true, scope = null, comps = null} = {}) {
  const rows = scope || scopeOf(st);
  const years = [...new Set(rows.map(r => r.year))].filter(Boolean).sort((a, b) => b - a);
  const styles = [...new Set(rows.map(r => r.style))].filter(Boolean).sort();
  const awards = awardOptions(rows);
  const list = comps || D.dims.competitions;
  const opt = (v, label, cur) =>
    `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  return `<div class="filters">
    ${list.length > 1 ? `<select id="f-comp" aria-label="Competition"><option value="">All competitions</option>
      ${list.map(c => opt(c.id, c.name, st.comp)).join('')}</select>` : ''}
    <select id="f-year" aria-label="Year"><option value="">All years</option>
      ${years.map(y => opt(y, y, st.year)).join('')}</select>
    <select id="f-award" aria-label="Award"><option value="">All awards</option>
      ${awards.map(a => opt(a.value, a.label, st.award)).join('')}</select>
    ${style && styles.length > 1 ? `<select id="f-style" aria-label="Style"><option value="">All styles</option>
      ${styles.map(s => opt(s, s, st.style)).join('')}</select>` : ''}
    ${search ? `<input type="search" id="f-q" placeholder="Search producer or cider"
      value="${esc(st.q)}">` : ''}
  </div>`;
}

/** `universe` is every row the view can show, before filtering: all awards on
 *  the competition page, one producer's awards on theirs. */
function wireFilters(universe = D.rows) {
  const bind = (id, key) => el(id) && el(id).addEventListener('change', e => writeState({[key]: e.target.value}));
  bind('f-year', 'year'); bind('f-award', 'award'); bind('f-style', 'style');

  // Changing competition drops any filter the new one has no rows for, so you
  // never land on an empty page holding a value its dropdown no longer offers.
  const comp = el('f-comp');
  if (comp) comp.addEventListener('change', e => {
    const id = e.target.value;
    const rows = id ? universe.filter(r => r.comp.id === id) : universe;
    const st = readState();
    const keep = (v, ok) => (v && ok ? v : '');
    writeState({
      comp: id,
      year: keep(st.year, rows.some(r => String(r.year) === st.year)),
      award: keep(st.award, rows.some(r => matchesAward(r, st.award))),
      style: keep(st.style, rows.some(r => r.style === st.style)),
    });
  });

  let timer;
  const q = el('f-q');
  if (q) q.addEventListener('input', e => {
    clearTimeout(timer);
    const v = e.target.value;
    timer = setTimeout(() => writeState({q: v}), 250);
  });
}

function medalsByYear(rows, node) {
  if (!node) return;
  const withYear = rows.filter(r => r.year);
  if (!withYear.length) { node.remove(); return; }
  const tiers = tiersIn(withYear);
  const label = Object.fromEntries(tiers.map(t => [t.id, t.label]));
  const data = withYear.map(r => ({year: r.year, tier: label[tierOf(r)]}));
  const order = tiers.map(t => t.label);   // highest prestige first
  node.replaceChildren(Plot.plot({
    height: 210, marginLeft: 46,
    x: {tickFormat: 'd', label: null},
    y: {label: 'awards', grid: true},
    color: {domain: order, range: tiers.map(t => tierColor(t.id)), legend: true},
    marks: [
      // Stacked so the top award sits on the axis and the humblest rides on
      // top: a bar reads as a podium, widest honour first.
      Plot.rectY(data, Plot.groupX({y: 'count'},
        {x: 'year', fill: 'tier', interval: 1, tip: true, order, reverse: true})),
      Plot.ruleY([0]),
    ],
  }));
}

function tally(rows) {
  const m = new Map();
  for (const r of rows) {
    const n = r.producer && r.producer.n;
    if (!n) continue;
    const t = m.get(n) || {name: n, total: 0};
    t.total++;
    const tier = tierOf(r);
    t[tier] = (t[tier] || 0) + 1;
    m.set(n, t);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

function awardLabel(r) {
  return `${esc(awardGlyph(r))} ${esc(awardName(awardValue(r)))}`.trim();
}

/** The award-level table: one row per award, sortable, capped for the DOM's
 *  sake. Lives here because it is the one view a producer tally cannot give
 *  you - which cider actually won. */
function resultsTable(showComp) {
  const heads = ['Year', showComp ? 'Competition' : null, 'Producer', 'Cider', 'Award', 'Style']
    .filter(Boolean);
  return `<h2 style="font-size:1.05rem">Results</h2>
  <div class="wrap"><table id="tbl"><thead><tr>
    ${heads.map((h, i) => `<th data-col="${i}">${h}</th>`).join('')}
  </tr></thead><tbody></tbody></table></div>
  <p class="note" id="tbl-note"></p>`;
}

const RESULT_CAP = 400;

function wireResultsTable(rows, showComp) {
  const table = el('tbl');
  if (!table) return;
  const body = table.tBodies[0];
  const note = el('tbl-note');
  const render = rs => {
    body.innerHTML = rs.slice(0, RESULT_CAP).map(r => {
      const name = (r.producer && r.producer.n) || '';
      return `<tr><td>${r.year || ''}</td>
      ${showComp ? `<td>${esc(r.comp.name)}</td>` : ''}
      <td><a href="#/producer?q=${encodeURIComponent(name)}">${esc(name)}</a></td>
      <td>${esc(r.entry)}</td><td>${awardLabel(r)}</td><td>${esc(r.style)}</td></tr>`;
    }).join('');
  };
  render(rows);
  if (note) {
    note.textContent = rows.length > RESULT_CAP
      ? `Showing the first ${RESULT_CAP} of ${num(rows.length)} awards. Narrow the filters to see the rest.`
      : `${num(rows.length)} award${rows.length === 1 ? '' : 's'}.`;
  }
  let dir = 1, last = -1;
  table.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const c = +th.dataset.col;
    dir = (c === last) ? -dir : 1;
    last = c;
    const rank = r => `${TIER_ORDER.indexOf(tierOf(r))}${awardName(awardValue(r))}`;
    const cols = [r => r.year, showComp ? (r => r.comp.name) : null,
                  r => (r.producer && r.producer.n) || '', r => r.entry, rank, r => r.style]
      .filter(Boolean);
    const key = cols[c];
    render([...rows].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir));
  }));
}

export function home() {
  const m = D.meta;
  return `<h2>Cider competition results, worldwide</h2>
  <p class="sub">Medals and awards from ${m.competitions} major hard cider competitions,
     ${m.year_min}&ndash;${m.year_max}.</p>
  <div class="stats">
    <div class="stat"><b>${num(m.awards)}</b><span>awards</span></div>
    <div class="stat"><b>${num(m.producers)}</b><span>producers</span></div>
    <div class="stat"><b>${m.competitions}</b><span>competitions</span></div>
    <div class="stat"><b>${m.year_min}&ndash;${m.year_max}</b><span>years</span></div>
    <div class="stat"><b>${Math.round(m.geocoded_share * 100)}%</b><span>mapped</span></div>
  </div>
  <div class="chart" id="ch-home"></div>
  <h2 style="font-size:1.05rem">Competitions</h2>
  <div class="cards">${D.dims.competitions.map(c => {
    const rs = D.rows.filter(r => r.comp.id === c.id);
    const ys = rs.map(r => r.year).filter(Boolean);
    const span = ys.length ? `${Math.min(...ys)}&ndash;${Math.max(...ys)}` : '';
    return `<a class="card" href="#/competition?comp=${c.id}"><b>${esc(c.name)}</b>
      <span>${num(rs.length)} awards &middot; ${span}</span></a>`;
  }).join('')}</div>
  <p class="note">The mapped share reflects producers matched to the World Cider Map.
     Unmapped producers still appear in every table and count &mdash; they simply have no pin.</p>`;
}
home.after = () => medalsByYear(D.rows, el('ch-home'));

export function map() {
  const st = readState();
  return `<h2>Medalists map</h2>
  <p class="sub">Every producer with a known location. Circle size shows total awards.</p>
  ${filterBar(st)}<div id="map"></div>
  <div class="legend">${tiersIn(scopeOf(st))
    .map(t => `<span><i style="background:${TIER_COLOR[t.id]}"></i>${esc(t.label)}</span>`).join('')}
    <span>Circle area &prop; awards</span></div>
  <p class="note" id="map-note"></p>`;
}
map.after = () => { wireFilters(); drawMap(); };

/** One competition's rows, or every competition's when none is chosen.
 *  `c` is null for "All competitions", which is a real selection here - not a
 *  fallback to the first competition in the list. */
function compScope(st) {
  const c = D.dims.competitions.find(x => x.id === st.comp) || null;
  const all = c ? D.rows.filter(r => r.comp.id === c.id) : D.rows;
  return {c, all, rows: apply(all, {...st, comp: ''})};
}

export function competition() {
  const st = readState();
  const {c, all, rows} = compScope(st);
  const years = [...new Set(rows.map(r => r.year))].filter(Boolean).sort((a, b) => b - a);
  const tiers = tiersIn(rows);
  const producers = new Set(rows.map(r => r.producer && r.producer.n).filter(Boolean)).size;
  const filtered = rows.length !== all.length;
  const span = years.length ? `${years[years.length - 1]}&ndash;${years[0]}` : 'no years';
  const top = tally(rows).slice(0, 15);
  const nComps = c ? 0 : compsIn(rows).length;
  return `<h2>${c ? esc(c.name) : 'All competitions'}</h2>
  <p class="sub">${filtered ? `${num(rows.length)} of ${num(all.length)} awards`
                            : `${num(all.length)} awards`}
     &middot; ${span} &middot; ${num(producers)} producer${producers === 1 ? '' : 's'}
     ${c ? '' : `&middot; ${num(nComps)} competition${nComps === 1 ? '' : 's'}`}</p>
  ${filterBar(st, {scope: all})}
  ${rows.length ? `<div class="chart" id="ch-comp"></div>
  <h2 style="font-size:1.05rem">Most decorated</h2>
  <div class="wrap"><table><thead><tr><th>Producer</th><th>Awards</th>
    ${tiers.map(t => `<th>${esc(t.label)}</th>`).join('')}
  </tr></thead><tbody>${top.map(t => `<tr>
    <td><a href="#/producer?q=${encodeURIComponent(t.name)}">${esc(t.name)}</a></td>
    <td>${t.total}</td>${tiers.map(x => `<td>${t[x.id] || ''}</td>`).join('')}
  </tr>`).join('')}</tbody></table></div>
  ${resultsTable(!c)}`
  : `<p class="note">No awards match these filters.
     <a href="#/competition${c ? `?comp=${c.id}` : ''}">Clear them</a>.</p>`}`;
}
competition.after = () => {
  const {c, rows} = compScope(readState());
  wireFilters();
  medalsByYear(rows, el('ch-comp'));
  wireResultsTable(rows, !c);
};

/** One producer's rows before and after filtering. `q` names the producer
 *  here, so it is dropped before filtering rather than used as a search term;
 *  `comp` is kept, because the dropdown narrows to one of their competitions. */
function prodScope(st) {
  const name = st.q.toLowerCase();
  const all = D.rows.filter(r => ((r.producer && r.producer.n) || '').toLowerCase() === name);
  return {p: all.length ? all[0].producer : null, all, rows: apply(all, {...st, q: ''})};
}

export function producer() {
  const st = readState();
  if (!st.q) {
    const top = tally(D.rows).slice(0, 60);
    return `<h2>Producers</h2>
    <p class="sub">Ranked by total awards across all competitions.</p>
    <div class="filters"><input type="search" id="f-q" placeholder="Search producers"></div>
    <div class="cards">${top.map(t => `<a class="card" href="#/producer?q=${encodeURIComponent(t.name)}">
      <b>${esc(t.name)}</b><span>${t.total} awards</span></a>`).join('')}</div>`;
  }
  const {p, all, rows} = prodScope(st);
  if (!p) {
    return `<h2>Not found</h2><p class="sub">No producer named &ldquo;${esc(st.q)}&rdquo;.
      <a href="#/producer">Back to producers</a></p>`;
  }
  // From `all`, not `rows`: the pills are this producer's record, and a
  // dropdown built from the filtered rows would delete the very option you
  // just picked, leaving no way back.
  const comps = compsIn(all);
  // The other dropdowns hang off the chosen competition, as they do on the
  // competition page, so their options are always ones this producer can show.
  const scope = st.comp ? all.filter(r => r.comp.id === st.comp) : all;
  const place = [p.t, p.r, p.ct].filter(Boolean).join(', ');
  const years = [...new Set(rows.map(r => r.year))].filter(Boolean).sort((a, b) => a - b);
  // An event is one competition in one year: five Australian Cider Awards is
  // five events but one competition.
  const events = new Set(rows.map(r => `${r.comp.id}|${r.year}`)).size;
  const filtered = rows.length !== all.length;
  const sorted = [...rows].sort((a, b) => b.year - a.year);
  return `<h2>${esc(p.n)}</h2>
  <p class="sub">${esc(place) || 'Location not recorded'}${p.w ?
    ` &middot; <a href="${esc(p.w)}" target="_blank" rel="noopener noreferrer">website</a>` : ''}</p>
  <div class="stats">
    <div class="stat"><b>${num(rows.length)}</b><span>awards</span></div>
    <div class="stat"><b>${num(events)}</b><span>events</span></div>
    <div class="stat"><b>${num(compsIn(rows).length)}</b><span>competitions</span></div>
    <div class="stat"><b>${years.length ? `${years[0]}&ndash;${years[years.length - 1]}` : '&mdash;'}</b>
      <span>years</span></div>
  </div>
  <p>${comps.map(c => `<a class="pill" href="#/competition?comp=${c.id}">${esc(c.name)}</a>`).join('')}</p>
  ${filterBar(st, {scope, comps, search: false})}
  ${filtered ? `<p class="note" style="margin-top:-.4rem">Filtered from ${num(all.length)} awards.
     <a href="#/producer?q=${encodeURIComponent(p.n)}">Clear</a>.</p>` : ''}
  ${rows.length ? `<div class="chart" id="ch-prod"></div>
  <div class="wrap"><table><thead><tr><th>Year</th><th>Competition</th><th>Cider</th>
    <th>Award</th><th>Category</th></tr></thead><tbody>
    ${sorted.map(r => `<tr><td>${r.year || ''}</td><td>${esc(r.comp.name)}</td>
      <td>${esc(r.entry)}</td><td>${awardLabel(r)}</td><td>${esc(r.category)}</td></tr>`).join('')}
  </tbody></table></div>` : ''}`;
}
producer.after = () => {
  const st = readState();
  const q = el('f-q');
  // The index page's box filters the cards in place; the detail page has none,
  // because ?q= there names the producer rather than searching.
  if (q && !st.q) q.addEventListener('input', e => {
    const v = e.target.value.toLowerCase();
    document.querySelectorAll('.card').forEach(c => {
      c.style.display = c.textContent.toLowerCase().includes(v) ? '' : 'none';
    });
  });
  if (!st.q) return;
  const {all, rows} = prodScope(st);
  wireFilters(all);
  medalsByYear(rows, el('ch-prod'));
};

let mapObj = null;

function drawMap() {
  const rows = apply(D.rows, readState());
  const agg = new Map();
  for (const r of rows) {
    const p = r.producer;
    if (!p || p.lat == null || p.lon == null) continue;
    const t = agg.get(p.n) || {p, n: 0, best: 99};
    t.n++;
    const rank = TIER_ORDER.indexOf(tierOf(r));
    if (rank >= 0 && rank < t.best) t.best = rank;
    agg.set(p.n, t);
  }
  const feats = [...agg.values()].map(t => ({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [t.p.lon, t.p.lat]},
    properties: {
      name: t.p.n, n: t.n,
      tier: TIER_ORDER[t.best] || 'other',
      place: [t.p.t, t.p.r, t.p.ct].filter(Boolean).join(', '),
    },
  }));

  const missing = new Set(rows.filter(r => r.producer && r.producer.lat == null)
    .map(r => r.producer.n)).size;
  const note = el('map-note');
  if (note) {
    note.textContent = `${feats.length.toLocaleString()} producers shown. `
      + `${missing.toLocaleString()} more match these filters but have no coordinates yet, `
      + `so they are absent from the map.`;
  }

  const colors = ['match', ['get', 'tier'],
    'top', cssVar('--t1'), 'gold', cssVar('--t2'), 'silver', cssVar('--t3'),
    'bronze', cssVar('--t4'), cssVar('--t5')];

  const data = {type: 'FeatureCollection', features: feats};

  if (mapObj) {
    const src = mapObj.getSource('p');
    if (src) src.setData(data);
    return;
  }

  mapObj = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron', // no API key required
    center: [-30, 42], zoom: 1.4,
    attributionControl: {compact: true},
  });
  mapObj.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
  mapObj.on('load', () => {
    mapObj.addSource('p', {type: 'geojson', data});
    mapObj.addLayer({
      id: 'pts', type: 'circle', source: 'p',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 4, 3, 9, 7, 17, 14, 26],
        'circle-color': colors,
        'circle-opacity': 0.72,
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(255,255,255,.85)',
      },
    });
    mapObj.on('click', 'pts', e => {
      const f = e.features[0].properties;
      new maplibregl.Popup({offset: 10}).setLngLat(e.lngLat).setHTML(
        `<b><a href="#/producer?q=${encodeURIComponent(f.name)}">${esc(f.name)}</a></b>
         ${esc(f.place)}<br>${f.n} award${f.n > 1 ? 's' : ''}`).addTo(mapObj);
    });
    mapObj.on('mouseenter', 'pts', () => { mapObj.getCanvas().style.cursor = 'pointer'; });
    mapObj.on('mouseleave', 'pts', () => { mapObj.getCanvas().style.cursor = ''; });
  });
}

export function teardownMap() {
  // Dropping the reference is not enough: MapLibre holds a live WebGL context
  // and render loop. Without remove() they accumulate on every navigation and
  // slowly choke the renderer.
  if (mapObj) { try { mapObj.remove(); } catch (e) { /* already gone */ } }
  mapObj = null;
}
