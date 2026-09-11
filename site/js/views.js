import {D, MEDAL_ORDER, MEDAL_LABEL, TIER_COLOR, titleCase, esc} from './data.js';
import {readState, writeState, apply} from './filters.js';

const el = id => document.getElementById(id);
const num = n => n.toLocaleString();
const cssVar = k => getComputedStyle(document.body).getPropertyValue(k).trim() || '#888';
const tierColor = m => cssVar(TIER_COLOR[m].slice(4, -1));

function filterBar(st, {style = true} = {}) {
  const years = [...new Set(D.rows.map(r => r.year))].filter(Boolean).sort((a, b) => b - a);
  const opt = (v, label, cur) =>
    `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  return `<div class="filters">
    <select id="f-comp"><option value="">All competitions</option>
      ${D.dims.competitions.map(c => opt(c.id, c.name, st.comp)).join('')}</select>
    <select id="f-year"><option value="">All years</option>
      ${years.map(y => opt(y, y, st.year)).join('')}</select>
    <select id="f-medal"><option value="">All awards</option>
      ${MEDAL_ORDER.filter(m => D.dims.medals.includes(m)).map(m => opt(m, MEDAL_LABEL[m], st.medal)).join('')}</select>
    ${style ? `<select id="f-style"><option value="">All styles</option>
      ${D.dims.styles.map(s => opt(s, s, st.style)).join('')}</select>` : ''}
    <input type="search" id="f-q" placeholder="Search producer or cider" value="${esc(st.q)}">
  </div>`;
}

function wireFilters() {
  const bind = (id, key) => el(id) && el(id).addEventListener('change', e => writeState({[key]: e.target.value}));
  bind('f-comp', 'comp'); bind('f-year', 'year'); bind('f-medal', 'medal'); bind('f-style', 'style');
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
  const data = rows.filter(r => r.medal).map(r => ({year: r.year, medal: MEDAL_LABEL[r.medal] || r.medal}));
  if (!data.length) { node.remove(); return; }
  const tiers = MEDAL_ORDER.filter(m => D.dims.medals.includes(m));
  node.replaceChildren(Plot.plot({
    height: 210, marginLeft: 46,
    x: {tickFormat: 'd', label: null},
    y: {label: 'awards', grid: true},
    color: {domain: tiers.map(m => MEDAL_LABEL[m]), range: tiers.map(tierColor), legend: true},
    marks: [
      Plot.rectY(data, Plot.groupX({y: 'count'}, {x: 'year', fill: 'medal', interval: 1, tip: true})),
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
    if (r.medal) t[r.medal] = (t[r.medal] || 0) + 1;
    m.set(n, t);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

function awardLabel(r) {
  const glyph = D.dims.medal_display[r.medal] || '';
  const word = r.special ? titleCase(r.special) : (MEDAL_LABEL[r.medal] || '');
  return `${esc(glyph)} ${esc(word)}`.trim();
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
  <div class="legend">${MEDAL_ORDER.filter(m => D.dims.medals.includes(m))
    .map(m => `<span><i style="background:${TIER_COLOR[m]}"></i>${MEDAL_LABEL[m]}</span>`).join('')}
    <span>Circle area &prop; awards</span></div>
  <p class="note" id="map-note"></p>`;
}
map.after = () => { wireFilters(); drawMap(); };

export function explore() {
  const st = readState();
  const rows = apply(D.rows, st);
  const heads = ['Year', 'Competition', 'Producer', 'Cider', 'Award', 'Style'];
  return `<h2>Explore</h2>
  <p class="sub">${num(rows.length)} of ${num(D.rows.length)} awards.</p>
  ${filterBar(st)}
  <div class="wrap"><table id="tbl"><thead><tr>
    ${heads.map((h, i) => `<th data-col="${i}">${h}</th>`).join('')}
  </tr></thead><tbody></tbody></table></div>
  <p class="note">Showing up to 400 rows. Narrow the filters to see the rest.</p>`;
}
explore.after = () => {
  wireFilters();
  const rows = apply(D.rows, readState());
  const body = el('tbl').tBodies[0];
  const render = rs => {
    body.innerHTML = rs.slice(0, 400).map(r => {
      const name = (r.producer && r.producer.n) || '';
      return `<tr><td>${r.year || ''}</td><td>${esc(r.comp.name)}</td>
      <td><a href="#/producer?q=${encodeURIComponent(name)}">${esc(name)}</a></td>
      <td>${esc(r.entry)}</td><td>${awardLabel(r)}</td><td>${esc(r.style)}</td></tr>`;
    }).join('');
  };
  render(rows);
  let dir = 1, last = -1;
  el('tbl').querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const c = +th.dataset.col;
    dir = (c === last) ? -dir : 1;
    last = c;
    const key = r => [r.year, r.comp.name, (r.producer && r.producer.n) || '', r.entry, r.medal, r.style][c];
    render([...rows].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir));
  }));
};

export function competition() {
  const st = readState();
  const c = D.dims.competitions.find(x => x.id === st.comp) || D.dims.competitions[0];
  const rows = D.rows.filter(r => r.comp.id === c.id);
  const years = [...new Set(rows.map(r => r.year))].filter(Boolean).sort((a, b) => b - a);
  const tiers = MEDAL_ORDER.filter(m => D.dims.medals.includes(m));
  const top = tally(rows).slice(0, 15);
  return `<h2>${esc(c.name)}</h2>
  <p class="sub">${num(rows.length)} awards &middot; ${years[years.length - 1]}&ndash;${years[0]}
     &middot; ${new Set(rows.map(r => r.producer && r.producer.n)).size} producers</p>
  <div class="filters"><select id="f-comp">
    ${D.dims.competitions.map(x =>
      `<option value="${x.id}"${x.id === c.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
  </select></div>
  <div class="chart" id="ch-comp"></div>
  <h2 style="font-size:1.05rem">Most decorated</h2>
  <div class="wrap"><table><thead><tr><th>Producer</th><th>Awards</th>
    ${tiers.map(m => `<th>${MEDAL_LABEL[m]}</th>`).join('')}
  </tr></thead><tbody>${top.map(t => `<tr>
    <td><a href="#/producer?q=${encodeURIComponent(t.name)}">${esc(t.name)}</a></td>
    <td>${t.total}</td>${tiers.map(m => `<td>${t[m] || ''}</td>`).join('')}
  </tr>`).join('')}</tbody></table></div>`;
}
competition.after = () => {
  const sel = el('f-comp');
  if (sel) sel.addEventListener('change', e => writeState({comp: e.target.value}));
  const st = readState();
  const c = D.dims.competitions.find(x => x.id === st.comp) || D.dims.competitions[0];
  medalsByYear(D.rows.filter(r => r.comp.id === c.id), el('ch-comp'));
};

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
  const rows = D.rows.filter(r => ((r.producer && r.producer.n) || '').toLowerCase() === st.q.toLowerCase());
  if (!rows.length) {
    return `<h2>Not found</h2><p class="sub">No producer named &ldquo;${esc(st.q)}&rdquo;.
      <a href="#/producer">Back to producers</a></p>`;
  }
  const p = rows[0].producer;
  const comps = [...new Set(rows.map(r => r.comp.name))];
  const place = [p.t, p.r, p.ct].filter(Boolean).join(', ');
  const sorted = [...rows].sort((a, b) => b.year - a.year);
  return `<h2>${esc(p.n)}</h2>
  <p class="sub">${esc(place) || 'Location not recorded'}${p.w ?
    ` &middot; <a href="${esc(p.w)}" rel="noopener">website</a>` : ''}</p>
  <div class="stats">
    <div class="stat"><b>${p.md}</b><span>medals</span></div>
    <div class="stat"><b>${rows.length}</b><span>awards</span></div>
    <div class="stat"><b>${comps.length}</b><span>competitions</span></div>
    <div class="stat"><b>${p.f}&ndash;${p.l}</b><span>years</span></div>
  </div>
  <p>${comps.map(c => `<span class="pill">${esc(c)}</span>`).join('')}</p>
  <div class="chart" id="ch-prod"></div>
  <div class="wrap"><table><thead><tr><th>Year</th><th>Competition</th><th>Cider</th>
    <th>Award</th><th>Category</th></tr></thead><tbody>
    ${sorted.map(r => `<tr><td>${r.year || ''}</td><td>${esc(r.comp.name)}</td>
      <td>${esc(r.entry)}</td><td>${awardLabel(r)}</td><td>${esc(r.category)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
producer.after = () => {
  const st = readState();
  const q = el('f-q');
  if (q) q.addEventListener('input', e => {
    const v = e.target.value.toLowerCase();
    document.querySelectorAll('.card').forEach(c => {
      c.style.display = c.textContent.toLowerCase().includes(v) ? '' : 'none';
    });
  });
  if (st.q) {
    medalsByYear(D.rows.filter(r =>
      ((r.producer && r.producer.n) || '').toLowerCase() === st.q.toLowerCase()), el('ch-prod'));
  }
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
    const rank = MEDAL_ORDER.indexOf(r.medal);
    if (rank >= 0 && rank < t.best) t.best = rank;
    agg.set(p.n, t);
  }
  const feats = [...agg.values()].map(t => ({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [t.p.lon, t.p.lat]},
    properties: {
      name: t.p.n, n: t.n,
      tier: MEDAL_ORDER[t.best] || 'commended',
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
    'double_gold', cssVar('--t1'), 'gold', cssVar('--t2'), 'silver', cssVar('--t3'),
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
