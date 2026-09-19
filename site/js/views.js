import {D, TIER_ORDER, TIER_COLOR, tierOf, tierLabel, awardGlyph, awardValue,
        awardName, awardOptions, producerLinks, LINK_NAME, esc} from './data.js';
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

function filterBar(st, {style = true, award = true, place = false,
                       search = true, scope = null, comps = null} = {}) {
  const rows = scope || scopeOf(st);
  const years = [...new Set(rows.map(r => r.year))].filter(Boolean).sort((a, b) => b - a);
  const styles = [...new Set(rows.map(r => r.style))].filter(Boolean).sort();
  const awards = awardOptions(rows);
  const list = comps || D.dims.competitions;
  const countries = [...new Set(rows.map(r => r.producer && r.producer.ct)
    .filter(Boolean))].sort();
  // Regions narrow to the chosen country: there are 346 of them worldwide,
  // which is a list nobody reads, against a handful inside one country.
  const regions = [...new Set(rows
    .filter(r => r.producer && (!st.country || r.producer.ct === st.country))
    .map(r => r.producer && r.producer.r).filter(Boolean))].sort();
  const opt = (v, label, cur) =>
    `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  return `<div class="filters">
    ${list.length > 1 ? `<select id="f-comp" aria-label="Competition"><option value="">All competitions</option>
      ${list.map(c => opt(c.id, c.name, st.comp)).join('')}</select>` : ''}
    <select id="f-year" aria-label="Year"><option value="">All years</option>
      ${years.map(y => opt(y, y, st.year)).join('')}</select>
    ${award ? `<select id="f-award" aria-label="Award"><option value="">All awards</option>
      ${awards.map(a => opt(a.value, a.label, st.award)).join('')}</select>` : ''}
    ${style && styles.length > 1 ? `<select id="f-style" aria-label="Style"><option value="">All styles</option>
      ${styles.map(s => opt(s, s, st.style)).join('')}</select>` : ''}
    ${place && countries.length > 1 ? `<select id="f-country" aria-label="Country">
      <option value="">All countries</option>
      ${countries.map(x => opt(x, x, st.country)).join('')}</select>` : ''}
    ${place && regions.length > 1 ? `<select id="f-region" aria-label="Region">
      <option value="">All regions</option>
      ${regions.map(x => opt(x, x, st.region)).join('')}</select>` : ''}
    ${search ? `<input type="search" id="f-q" placeholder="Search producer or cider"
      value="${esc(st.q)}">` : ''}
  </div>`;
}

/** `universe` is every row the view can show, before filtering: all awards on
 *  the competition page, one producer's awards on theirs. */
function wireFilters(universe = D.rows) {
  const bind = (id, key) => el(id) && el(id).addEventListener('change', e => writeState({[key]: e.target.value}));
  bind('f-year', 'year'); bind('f-award', 'award'); bind('f-style', 'style');
  bind('f-region', 'region');

  // Picking a country drops a region that is not in it, the same way picking a
  // competition drops filters it has no rows for.
  const country = el('f-country');
  if (country) country.addEventListener('change', e => {
    const ct = e.target.value;
    const st = readState();
    const stillThere = !st.region || universe.some(r => r.producer
      && r.producer.r === st.region && (!ct || r.producer.ct === ct));
    writeState({country: ct, region: stillThere ? st.region : ''});
  });

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
      country: keep(st.country, rows.some(r => r.producer && r.producer.ct === st.country)),
      region: keep(st.region, rows.some(r => r.producer && r.producer.r === st.region)),
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

/** `universe` is the view's rows before filtering. It fixes the year axis, so
 *  bars keep their width and their place when a filter thins them out.
 *  `onYear`, if given, makes the bars an input as well as an output. */
function medalsByYear(rows, node, universe = rows, onYear = null) {
  if (!node) return;
  const withYear = rows.filter(r => r.year);
  if (!withYear.length) { node.remove(); return; }
  const tiers = tiersIn(withYear);
  const label = Object.fromEntries(tiers.map(t => [t.id, t.label]));
  const order = tiers.map(t => t.label);   // highest prestige first

  // Years are bands, not numbers on a line. A competition year sits wholly
  // inside one calendar year, so the bar belongs over its label rather than
  // in the span after it, and the tip should say 2025, not "2,025-2,026".
  // Strings keep the number formatter away from the year entirely.
  const span = universe.map(r => r.year).filter(Boolean);
  const lo = Math.min(...span), hi = Math.max(...span);
  const domain = [];
  for (let y = lo; y <= hi; y++) domain.push(String(y));
  // Gaps stay visible: a year the competition was not held keeps its empty slot.
  const step = domain.length > 14 ? 2 : 1;
  const ticks = domain.filter((_, i) => (domain.length - 1 - i) % step === 0);
  // Field names surface as the tip's row labels, so they read as words.
  const data = withYear.map(r => ({year: String(r.year), award: label[tierOf(r)]}));

  // Awards come in whole numbers, so a filtered-down chart topping out at 3
  // gets ticks at 0..3 rather than every half.
  const perYear = new Map();
  for (const d of data) perYear.set(d.year, (perYear.get(d.year) || 0) + 1);
  const peak = Math.max(0, ...perYear.values());
  const yScale = peak <= 8
    ? {ticks: Array.from({length: peak + 1}, (_, i) => i), tickFormat: 'd'}
    : {tickFormat: 'd'};

  const fig = Plot.plot({
    height: 210, marginLeft: 46,
    x: {domain, ticks, label: null},
    y: {label: 'awards', grid: true, ...yScale},
    color: {domain: order, range: tiers.map(t => tierColor(t.id)), legend: true},
    marks: [
      // Stacked so the top award sits on the axis and the humblest rides on
      // top: a bar reads as a podium, widest honour first.
      Plot.barY(data, Plot.groupX({y: 'count'},
        {x: 'year', fill: 'award', tip: true, order, reverse: true})),
      Plot.ruleY([0]),
    ],
  });
  node.replaceChildren(fig);
  if (onYear) makeYearsClickable(fig, onYear);
}

/** Turn the chart into a filter control: click anywhere in a year's column to
 *  select that year. Hit-testing runs off the band scale rather than the bars
 *  themselves, so the empty years are clickable too, and a year with no awards
 *  is as easy to leave as to reach. */
function makeYearsClickable(fig, onYear) {
  const x = typeof fig.scale === 'function' ? fig.scale('x') : null;
  if (!x || !x.bandwidth || typeof x.apply !== 'function') return;
  const svg = [...fig.querySelectorAll('svg')]
    .find(s => s.querySelector('[aria-label*="x-axis"]')) || fig.querySelector('svg');
  if (!svg) return;
  svg.style.cursor = 'pointer';
  svg.addEventListener('click', ev => {
    const box = svg.getBoundingClientRect();
    const at = ev.clientX - box.left;
    const hit = x.domain.find(v => {
      const left = x.apply(v);
      return at >= left && at <= left + x.bandwidth;
    });
    if (hit != null) onYear(String(hit));
  });
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

/** Click a header to sort by it; click again to reverse. `keys[i]` extracts
 *  the sort value for column i. */
function makeSortable(table, data, keys, render) {
  let dir = 1, last = -1;
  table.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const c = +th.dataset.col;
    if (!keys[c]) return;
    dir = (c === last) ? -dir : 1;
    last = c;
    const key = keys[c];
    // `data` may be a getter, so sorting reorders what is on screen rather
    // than throwing away a search the reader has already typed.
    const list = typeof data === 'function' ? data() : data;
    render([...list].sort((a, b) => {
      const x = key(a), y = key(b);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    }));
  }));
}

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
  const rank = r => `${TIER_ORDER.indexOf(tierOf(r))}${awardName(awardValue(r))}`;
  makeSortable(table, rows, [r => r.year, showComp ? (r => r.comp.name) : null,
    r => (r.producer && r.producer.n) || '', r => r.entry, rank, r => r.style]
    .filter(Boolean), render);
}

/** One row per competition: how big, how long-running, how selective, how far
 *  its entries travel, how much ground it judges. Comparing the competitions
 *  to each other is the one thing no other view can do. */
function leagueRows(rows) {
  const by = new Map();
  for (const r of rows) {
    let t = by.get(r.comp.id);
    if (!t) {
      t = {comp: r.comp, awards: 0, top: 0, years: new Set(),
           producers: new Set(), countries: new Set(), styles: new Set()};
      by.set(r.comp.id, t);
    }
    t.awards++;
    const tier = tierOf(r);
    // "Gold or above" counts the gold tier and everything that outranks it,
    // so a Best in Class or a Double Gold counts once, like the gold it is.
    if (tier === 'top' || tier === 'gold') t.top++;
    if (r.year) t.years.add(r.year);
    const p = r.producer;
    if (p && p.n) t.producers.add(p.n);
    if (p && p.ct) t.countries.add(p.ct);
    if (r.style) t.styles.add(r.style);
  }
  return [...by.values()].map(t => {
    const ys = [...t.years].sort((a, b) => a - b);
    return {
      id: t.comp.id, name: t.comp.name,
      editions: t.years.size,
      from: ys[0] || 0, to: ys[ys.length - 1] || 0,
      awards: t.awards,
      producers: t.producers.size,
      selectivity: t.awards ? t.top / t.awards : 0,
      countries: t.countries.size,
      styles: t.styles.size,
    };
  }).sort((a, b) => b.awards - a.awards);
}

const LEAGUE_HEADS = [
  ['Competition', ''], ['Editions', 'n'], ['Years', 'n'], ['Awards', 'n'],
  ['Producers', 'n'], ['Gold or above', 'n'], ['Countries', 'n'], ['Styles', 'n'],
];

function leagueTable() {
  return `<h2 style="font-size:1.05rem">Competitions compared</h2>
  <div class="wrap"><table id="league"><thead><tr>
    ${LEAGUE_HEADS.map(([h, cls], i) =>
      `<th data-col="${i}"${cls ? ` class="${cls}"` : ''}>${h}</th>`).join('')}
  </tr></thead><tbody></tbody></table></div>
  <p class="note">Gold or above is the share of a competition's awards at the gold tier
     or better, trophies included. It is the closest thing here to how hard a competition
     is to win, and it varies more than anything else on this page. Countries counts the
     producers matched to the World Cider Map, so a year still awaiting that match shows
     fewer countries than it drew &mdash; read it as a floor, not a total.</p>`;
}

function wireLeagueTable(rows) {
  const table = el('league');
  if (!table) return;
  const data = leagueRows(rows);
  const body = table.tBodies[0];
  const render = rs => {
    body.innerHTML = rs.map(t => `<tr>
      <td><a href="#/competition?comp=${t.id}">${esc(t.name)}</a></td>
      <td class="n">${t.editions}</td>
      <td class="n">${t.from ? `${t.from}&ndash;${t.to}` : ''}</td>
      <td class="n">${num(t.awards)}</td>
      <td class="n">${num(t.producers)}</td>
      <td class="n">${Math.round(t.selectivity * 100)}%</td>
      <td class="n">${t.countries}</td>
      <td class="n">${t.styles}</td>
    </tr>`).join('');
  };
  render(data);
  makeSortable(table, data, [t => t.name, t => t.editions, t => t.from, t => t.awards,
    t => t.producers, t => t.selectivity, t => t.countries, t => t.styles], render);
}

export function home() {
  const st = readState();
  const rows = apply(D.rows, st);
  const filtered = rows.length !== D.rows.length;
  const years = [...new Set(rows.map(r => r.year))].filter(Boolean).sort((a, b) => a - b);
  const producers = new Set(rows.map(r => r.producer && r.producer.n).filter(Boolean));
  const mapped = new Set(rows.filter(r => r.producer && r.producer.lat != null)
    .map(r => r.producer.n));
  const share = producers.size ? Math.round(mapped.size / producers.size * 100) : 0;
  return `<h2>Cider competition results, worldwide</h2>
  <p class="sub">Medals and awards from ${D.meta.competitions} major hard cider competitions,
     ${D.meta.year_min}&ndash;${D.meta.year_max}. Filter once; the map and the chart both follow.</p>
  ${filterBar(st)}
  <div class="stats">
    <div class="stat"><b>${num(rows.length)}</b><span>awards</span></div>
    <div class="stat"><b>${num(producers.size)}</b><span>producers</span></div>
    <div class="stat"><b>${num(compsIn(rows).length)}</b><span>competitions</span></div>
    <div class="stat"><b>${years.length ? `${years[0]}&ndash;${years[years.length - 1]}` : '&mdash;'}</b>
      <span>years</span></div>
    <div class="stat"><b>${share}%</b><span>mapped</span></div>
  </div>
  ${rows.length ? `<div id="map" class="map-home"></div>
  <div class="legend">${tiersIn(rows)
    .map(t => `<span><i style="background:${TIER_COLOR[t.id]}"></i>${esc(t.label)}</span>`).join('')}
    <span>Circle area &prop; awards</span></div>
  <p class="note" id="map-note"></p>
  <div class="chart" id="ch-home"></div>
  <p class="note">Click a year to filter to it. The mapped share reflects producers matched to
     the World Cider Map; unmapped producers still appear in every table and count, they simply
     have no pin.</p>`
  : `<p class="note">No awards match these filters. <a href="#/">Clear them</a>.</p>`}
  ${st.comp ? '' : `<h2 style="font-size:1.05rem">Competitions</h2>
  <div class="cards">${compsIn(rows).map(c => {
    const rs = rows.filter(r => r.comp.id === c.id);
    const ys = rs.map(r => r.year).filter(Boolean);
    const span = ys.length ? `${Math.min(...ys)}&ndash;${Math.max(...ys)}` : '';
    return `<a class="card" href="#/competition?comp=${c.id}"><b>${esc(c.name)}</b>
      <span>${num(rs.length)} awards &middot; ${span}</span></a>`;
  }).join('')}</div>`}`;
}
home.after = () => {
  wireFilters();
  const rows = apply(D.rows, readState());
  if (!rows.length) return;
  drawMap();
  // The axis follows the chosen competition, exactly as it does on the
  // competition page, so the same competition charts the same way in both.
  // Year, award and style filters leave it alone, so thinning the results
  // empties slots instead of resizing bars.
  medalsByYear(rows, el('ch-home'), scopeOf(readState()), year => {
    writeState({year: year === readState().year ? '' : year});
  });
};


// Brand marks, drawn from their owners' own logo outlines so each one is
// recognisable at a glance: the generic glyphs that came before made a reader
// guess which service they were about to open. Filled with currentColor, so
// they inherit the muted row and its hover like everything else.
//
// Logo outlines: Simple Icons (CC0 1.0). Globe: Bootstrap Icons (MIT). Each
// mark is a trademark of its owner and is used here only to link to that
// service's page for the producer.
const LINK_ICON = {
  w: {vb: '0 0 16 16', d: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855A8 8 0 0 0 5.145 4H7.5zM4.09 4a9.3 9.3 0 0 1 .64-1.539 7 7 0 0 1 .597-.933A7.03 7.03 0 0 0 2.255 4zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a7 7 0 0 0-.656 2.5zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5zM8.5 5v2.5h2.99a12.5 12.5 0 0 0-.337-2.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5zM5.145 12q.208.58.468 1.068c.552 1.035 1.218 1.65 1.887 1.855V12zm.182 2.472a7 7 0 0 1-.597-.933A9.3 9.3 0 0 1 4.09 12H2.255a7 7 0 0 0 3.072 2.472M3.82 11a13.7 13.7 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5zm6.853 3.472A7 7 0 0 0 13.745 12H11.91a9.3 9.3 0 0 1-.64 1.539 7 7 0 0 1-.597.933M8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855q.26-.487.468-1.068zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.7 13.7 0 0 1-.312 2.5m2.802-3.5a7 7 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7 7 0 0 0-3.072-2.472c.218.284.418.598.597.933M10.855 4a8 8 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4z'},
  f: {vb: '0 0 24 24', d: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z'},
  i: {vb: '0 0 24 24', d: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077'},
  g: {vb: '0 0 24 24', d: 'M19.527 4.799c1.212 2.608.937 5.678-.405 8.173-1.101 2.047-2.744 3.74-4.098 5.614-.619.858-1.244 1.75-1.669 2.727-.141.325-.263.658-.383.992-.121.333-.224.673-.34 1.008-.109.314-.236.684-.627.687h-.007c-.466-.001-.579-.53-.695-.887-.284-.874-.581-1.713-1.019-2.525-.51-.944-1.145-1.817-1.79-2.671L19.527 4.799zM8.545 7.705l-3.959 4.707c.724 1.54 1.821 2.863 2.871 4.18.247.31.494.622.737.936l4.984-5.925-.029.01c-1.741.601-3.691-.291-4.392-1.987a3.377 3.377 0 0 1-.209-.716c-.063-.437-.077-.761-.004-1.198l.001-.007zM5.492 3.149l-.003.004c-1.947 2.466-2.281 5.88-1.117 8.77l4.785-5.689-.058-.05-3.607-3.035zM14.661.436l-3.838 4.563a.295.295 0 0 1 .027-.01c1.6-.551 3.403.15 4.22 1.626.176.319.323.683.377 1.045.068.446.085.773.012 1.22l-.003.016 3.836-4.561A8.382 8.382 0 0 0 14.67.439l-.009-.003zM9.466 5.868L14.162.285l-.047-.012A8.31 8.31 0 0 0 11.986 0a8.439 8.439 0 0 0-6.169 2.766l-.016.018 3.665 3.084z'},
  u: {vb: '0 0 24 24', d: 'M11 13.299l-5.824 8.133c-.298.416-.8.635-1.308.572-.578-.072-1.374-.289-2.195-.879S.392 19.849.139 19.323a1.402 1.402 0 0 1 .122-1.425l5.824-8.133a3.066 3.066 0 0 1 1.062-.927l1.146-.604c.23-.121.436-.283.608-.478.556-.631 2.049-2.284 4.696-4.957l.046-.212a.134.134 0 0 1 .096-.1l.146-.037a.135.135 0 0 0 .101-.141l-.015-.18a.13.13 0 0 1 .125-.142c.176-.005.518.046 1.001.393s.64.656.692.824a.13.13 0 0 1-.095.164l-.175.044a.133.133 0 0 0-.101.141l.012.15a.131.131 0 0 1-.063.123l-.186.112c-1.679 3.369-2.764 5.316-3.183 6.046a2.157 2.157 0 0 0-.257.73l-.205 1.281A3.074 3.074 0 0 1 11 13.3zm12.739 4.598l-5.824-8.133a3.066 3.066 0 0 0-1.062-.927l-1.146-.605a2.138 2.138 0 0 1-.608-.478 50.504 50.504 0 0 0-.587-.654.089.089 0 0 0-.142.018 97.261 97.261 0 0 1-1.745 3.223 1.42 1.42 0 0 0-.171.485 3.518 3.518 0 0 0 0 1.103l.01.064c.075.471.259.918.536 1.305l5.824 8.133c.296.413.79.635 1.294.574a4.759 4.759 0 0 0 2.209-.881 4.762 4.762 0 0 0 1.533-1.802 1.4 1.4 0 0 0-.122-1.425zM8.306 3.366l.175.044a.134.134 0 0 1 .101.141l-.012.15a.13.13 0 0 0 .063.123l.186.112c.311.623.599 1.194.869 1.721.026.051.091.06.129.019.437-.469.964-1.025 1.585-1.668a.137.137 0 0 0 .003-.19c-.315-.322-.645-.659-1.002-1.02l-.046-.212a.13.13 0 0 0-.096-.099l-.146-.037a.135.135 0 0 1-.101-.141l.015-.18a.13.13 0 0 0-.123-.142c-.175-.005-.518.045-1.002.393-.483.347-.64.656-.692.824a.13.13 0 0 0 .095.164z'},
  y: {vb: '0 0 24 24', d: 'm7.6885 15.1415-3.6715.8483c-.3769.0871-.755.183-1.1452.155-.2611-.0188-.5122-.0414-.7606-.213a1.179 1.179 0 0 1-.331-.3594c-.3486-.5519-.3656-1.3661-.3697-2.0004a6.2874 6.2874 0 0 1 .3314-2.0642 1.857 1.857 0 0 1 .1073-.2474 2.3426 2.3426 0 0 1 .1255-.2165 2.4572 2.4572 0 0 1 .1563-.1975 1.1736 1.1736 0 0 1 .399-.2831 1.082 1.082 0 0 1 .4592-.0837c.2355.0016.5139.052.91.1734.0555.0191.1237.0382.1856.0572.3277.1013.7048.2404 1.1499.3987.6863.2404 1.3663.487 2.0463.7397l1.2117.4423c.2217.0807.4363.18.6412.297.174.0984.3273.2298.4512.387a1.217 1.217 0 0 1 .192.4309 1.2205 1.2205 0 0 1-.872 1.4522c-.0468.0151-.0852.0239-.1085.0293l-1.105.2553-.0031-.001zM18.8208 7.565a1.8506 1.8506 0 0 0-.2042-.1754 2.4082 2.4082 0 0 0-.2077-.1394 2.3607 2.3607 0 0 0-.2269-.109 1.1705 1.1705 0 0 0-.482-.0796 1.0862 1.0862 0 0 0-.4498.1263c-.2107.1048-.4388.2732-.742.5551-.042.0417-.0947.0886-.142.133-.2502.2351-.5286.5252-.8599.863a114.6363 114.6363 0 0 0-1.5166 1.5629l-.8962.9293a4.1897 4.1897 0 0 0-.4466.5483 1.541 1.541 0 0 0-.2364.5459 1.2199 1.2199 0 0 0 .0107.4518l.0046.02a1.218 1.218 0 0 0 1.4184.923 1.162 1.162 0 0 0 .1105-.0213l4.7781-1.104c.3766-.087.7587-.1667 1.097-.3631.2269-.1316.4428-.262.5909-.5252a1.1793 1.1793 0 0 0 .1405-.4683c.0733-.6512-.2668-1.3908-.5403-1.963a6.2792 6.2792 0 0 0-1.2001-1.7103zM8.9703.0754a8.6724 8.6724 0 0 0-.83.1564c-.2754.066-.548.1383-.8146.2236-.868.2844-2.0884.8063-2.295 1.8065-.1165.5655.1595 1.1439.3737 1.66.2595.6254.614 1.1889.9373 1.7777.8543 1.5545 1.7245 3.0993 2.5922 4.6457.259.4617.5416 1.0464 1.043 1.2856a1.058 1.058 0 0 0 .1013.0383c.2248.0851.4699.1016.7041.0471a4.3015 4.3015 0 0 0 .0418-.0097 1.2136 1.2136 0 0 0 .5658-.3397 1.1033 1.1033 0 0 0 .079-.0822c.3463-.435.3454-1.0833.3764-1.6134.1042-1.771.2139-3.5423.3009-5.3142.0332-.6712.1055-1.3333.0655-2.0096-.0328-.5579-.0368-1.1984-.3891-1.6563-.6218-.8073-1.9476-.741-2.8523-.6158zm2.084 15.9505a1.1053 1.1053 0 0 0-1.2306-.4145 1.1398 1.1398 0 0 0-.1526.0633 1.4806 1.4806 0 0 0-.2171.1354c-.1992.1475-.3668.3392-.5196.5315-.0386.049-.074.1143-.12.1562l-.7686 1.0573a113.9168 113.9168 0 0 0-1.2913 1.789c-.278.3895-.5184.7184-.7083 1.0094-.036.0547-.0734.116-.1075.1647-.2277.3522-.3566.6092-.4228.8381a1.0945 1.0945 0 0 0-.046.4721c.0211.1655.0768.3246.1635.467.046.0715.0957.1406.1487.207a2.334 2.334 0 0 0 .1754.1825 1.843 1.843 0 0 0 .2108.1732c.5304.369 1.1112.6342 1.722.8391a6.0958 6.0958 0 0 0 1.5716.3004c.091.0046.1821.0025.2728-.006a2.3878 2.3878 0 0 0 .2506-.0351 2.3862 2.3862 0 0 0 .2447-.071 1.1927 1.1927 0 0 0 .4175-.2658c.1127-.113.1994-.249.2541-.3989.0889-.2214.1473-.5026.1857-.92.0034-.0593.0118-.1305.0177-.1958.0304-.3463.0443-.7531.0666-1.2315.0375-.7357.067-1.4681.0903-2.2026 0 0 .0495-1.3053.0494-1.306.0113-.3008.002-.6342-.0814-.9336a1.396 1.396 0 0 0-.1756-.4054zm8.6754 2.0439c-.1605-.176-.3878-.3514-.7462-.5682-.0518-.0288-.1124-.0674-.1684-.1009-.2985-.1795-.658-.3684-1.078-.5965a120.7615 120.7615 0 0 0-1.9427-1.042l-1.1515-.6107c-.0597-.0175-.1203-.0607-.1766-.0878-.2212-.1058-.4558-.2045-.6992-.2498a1.4915 1.4915 0 0 0-.2545-.0265 1.1527 1.1527 0 0 0-.1648.01 1.1077 1.1077 0 0 0-.9227.9133 1.4186 1.4186 0 0 0 .0159.439c.0563.3065.1932.6096.3346.875l.615 1.1526c.3422.65.6884 1.2963 1.0435 1.9406.229.4202.4196.7799.5982 1.078.0338.056.0721.1163.1011.1682.2173.3584.392.584.569.7458.1146.1107.252.195.4026.247.1583.0525.326.071.4919.0546a2.368 2.368 0 0 0 .251-.0435c.0817-.022.1622-.048.241-.0784a1.863 1.863 0 0 0 .2475-.1143 6.1018 6.1018 0 0 0 1.2818-.9597c.4596-.4522.8659-.9454 1.182-1.51.044-.08.0819-.163.1138-.2483a2.49 2.49 0 0 0 .0773-.2411c.0186-.083.033-.1669.0429-.2513a1.188 1.188 0 0 0-.0565-.491 1.0933 1.0933 0 0 0-.248-.4041zm2.86 3.742a.8523.8523 0 0 1-.111.4236c-.074.132-.178.2377-.3115.3172a.8428.8428 0 0 1-.4385.119.847.847 0 0 1-.4373-.1179.8526.8526 0 0 1-.3125-.3171.8548.8548 0 0 1-.111-.4248c0-.1526.038-.2958.1143-.4294a.8405.8405 0 0 1 .315-.3159.849.849 0 0 1 .4315-.1156.8514.8514 0 0 1 .4294.1144.84.84 0 0 1 .316.3148.8494.8494 0 0 1 .1156.4317zm-.1202 0c0-.1328-.0332-.256-.0996-.3698s-.1564-.2038-.2702-.2702a.7125.7125 0 0 0-.371-.1007.7204.7204 0 0 0-.3698.0996.7487.7487 0 0 0-.2713.2702.7181.7181 0 0 0-.0996.3709c0 .132.0332.2557.0996.371a.7355.7355 0 0 0 .2713.2713.7354.7354 0 0 0 .3698.0985.7205.7205 0 0 0 .3698-.0996.7423.7423 0 0 0 .2702-.2691.7186.7186 0 0 0 .1008-.3721zm-.577.0584.2724.4522h-.1922l-.237-.4052h-.1546v.4052h-.1695v-1.02h.2988c.1268 0 .2195.0247.2783.0744.0595.0496.0892.1252.0892.2267a.2785.2785 0 0 1-.0492.1625c-.032.0466-.0775.0813-.1362.1042zm-.0412-.1408a.1532.1532 0 0 0 .056-.1214c0-.0573-.0164-.0981-.0491-.1225-.0329-.0251-.0847-.0377-.1557-.0377h-.1214v.3285h.1237c.061 0 .1098-.0157.1465-.047z'},
  t: {vb: '0 0 24 24', d: 'M12.006 4.295c-2.67 0-5.338.784-7.645 2.353H0l1.963 2.135a5.997 5.997 0 0 0 4.04 10.43 5.976 5.976 0 0 0 4.075-1.6L12 19.705l1.922-2.09a5.972 5.972 0 0 0 4.072 1.598 6 6 0 0 0 6-5.998 5.982 5.982 0 0 0-1.957-4.432L24 6.648h-4.35a13.573 13.573 0 0 0-7.644-2.353zM12 6.255c1.531 0 3.063.303 4.504.903C13.943 8.138 12 10.43 12 13.1c0-2.671-1.942-4.962-4.504-5.942A11.72 11.72 0 0 1 12 6.256zM6.002 9.157a4.059 4.059 0 1 1 0 8.118 4.059 4.059 0 0 1 0-8.118zm11.992.002a4.057 4.057 0 1 1 .003 8.115 4.057 4.057 0 0 1-.003-8.115zm-11.992 1.93a2.128 2.128 0 0 0 0 4.256 2.128 2.128 0 0 0 0-4.256zm11.992 0a2.128 2.128 0 0 0 0 4.256 2.128 2.128 0 0 0 0-4.256z'},
};

/** A producer's links as a row of small marks. Empty when there are none,
 *  which is true for 274 of 2,166 producers. */
function linkRow(p) {
  const links = producerLinks(p);
  if (!links.length) return '';
  return `<p class="links">${links.map(([k, url]) =>
    `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"
        title="${esc(LINK_NAME[k])}" aria-label="${esc(LINK_NAME[k])}">
      <svg viewBox="${LINK_ICON[k].vb}" width="15" height="15" fill="currentColor"
           aria-hidden="true"><path d="${LINK_ICON[k].d}"/></svg></a>`).join('')}</p>`;
}

/** Share of awards at the gold tier or above: the closest thing the data has
 *  to how hard a competition is to win. */
function selectivity(rows) {
  if (!rows.length) return null;
  const top = rows.filter(r => {
    const t = tierOf(r);
    return t === 'top' || t === 'gold';
  }).length;
  return top / rows.length;
}

let rankCache = null;

/** Where a competition sits among all of them on selectivity. A percentage on
 *  its own means little; "the third lowest share of nineteen" is the useful
 *  form, and only this page can say it. Ranked low share first, so rank 1 is
 *  the competition most sparing with its golds, and ranked on the full record
 *  rather than the filtered view, so it does not move as you narrow the year. */
function selectivityRank(id) {
  if (!rankCache) {
    const ranked = D.dims.competitions
      .map(c => ({id: c.id, s: selectivity(D.rows.filter(r => r.comp.id === c.id)) ?? 0}))
      .sort((a, b) => a.s - b.s);
    rankCache = ranked.map((x, i) => ({...x, rank: i + 1, of: ranked.length}));
  }
  return rankCache.find(x => x.id === id);
}

const ordinal = n => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({1: 'st', 2: 'nd', 3: 'rd'})[n % 10] || 'th'}`;
};

/** Say a rank from whichever end is closer, so the extremes read as "the
 *  lowest" rather than "the 1st lowest", and 17th of 19 as "3rd highest". */
function rankPhrase(rank, of) {
  if (rank === 1) return `the lowest of ${of}`;
  if (rank === of) return `the highest of ${of}`;
  return rank * 2 <= of
    ? `the ${ordinal(rank)} lowest of ${of}`
    : `the ${ordinal(of - rank + 1)} highest of ${of}`;
}

/** The trophies of one edition: Best in Class, Champion, Winner. The headline
 *  result of a year, and the thing a producer tally cannot tell you. */
function topHonours(rows) {
  const trophies = rows.filter(r => r.kind === 'trophy' && r.year);
  if (!trophies.length) return null;
  const year = Math.max(...trophies.map(r => r.year));
  const items = trophies.filter(r => r.year === year)
    .sort((a, b) => (a.category || '').localeCompare(b.category || ''));
  return {year, items, editions: new Set(trophies.map(r => r.year)).size};
}

/** The competition's own class names, which say what it thinks cider is. */
function categoriesIn(rows) {
  const m = new Map();
  for (const r of rows) if (r.category) m.set(r.category, (m.get(r.category) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Countries where the competition draws from more than one, regions where it
 *  does not - a national competition is better described by its regions. */
function originsIn(rows) {
  const countries = new Map(), regions = new Map();
  const add = (map, key, name) => {
    if (!key) return;
    const set = map.get(key) || new Set();
    set.add(name);
    map.set(key, set);
  };
  for (const r of rows) {
    const p = r.producer;
    if (!p || !p.n) continue;
    add(countries, p.ct, p.n);
    add(regions, p.r, p.n);
  }
  const wide = countries.size > 1;
  const use = wide ? countries : regions;
  return {
    label: wide ? 'country' : 'region',
    items: [...use.entries()].map(([k, v]) => [k, v.size])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/** A capped list of name/count pairs, with the tail summarised rather than cut. */
function countList(items, cap, unit) {
  if (!items.length) return '';
  const shown = items.slice(0, cap);
  const rest = items.slice(cap);
  const restTotal = rest.reduce((n, [, v]) => n + v, 0);
  return `<ul class="tallies">
    ${shown.map(([name, n]) =>
      `<li><span>${esc(name)}</span><b>${num(n)}</b></li>`).join('')}
    ${rest.length ? `<li class="more"><span>and ${num(rest.length)} more</span>
      <b>${num(restTotal)}</b></li>` : ''}
  </ul><p class="note">${num(items.length)} ${unit}${items.length === 1 ? '' : 's'} in all.</p>`;
}

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
  const nComps = c ? 0 : compsIn(rows).length;
  const sel = selectivity(rows);
  const rank = c ? selectivityRank(c.id) : null;
  const honours = c ? topHonours(rows) : null;
  const cats = c ? categoriesIn(rows) : [];
  const origins = c ? originsIn(rows) : {label: '', items: []};
  const countries = new Set(rows.map(r => r.producer && r.producer.ct).filter(Boolean)).size;
  return `<h2>${c ? esc(c.name) : 'All competitions'}</h2>
  <p class="sub">${filtered ? `${num(rows.length)} of ${num(all.length)} awards`
                            : `${num(all.length)} awards`}
     &middot; ${span} &middot; ${num(producers)} producer${producers === 1 ? '' : 's'}
     ${c ? '' : `&middot; ${num(nComps)} competition${nComps === 1 ? '' : 's'}`}</p>
  ${filterBar(st, {scope: all})}
  ${rows.length ? `${c ? `<div class="stats">
    <div class="stat"><b>${num(rows.length)}</b><span>awards</span></div>
    <div class="stat"><b>${num(years.length)}</b><span>edition${years.length === 1 ? '' : 's'}</span></div>
    ${st.award ? '' : `<div class="stat"><b>${Math.round(sel * 100)}%</b>
      <span>gold or above</span></div>`}
    <div class="stat"><b>${num(producers)}</b><span>producers</span></div>
    ${countries ? `<div class="stat"><b>${num(countries)}</b><span>countries</span></div>` : ''}
  </div>
  ${rank ? `<p class="note" style="margin-top:-.6rem">Across its whole record, gold or
     better accounts for ${Math.round(rank.s * 100)}% of its awards,
     ${rankPhrase(rank.rank, rank.of)} competitions.</p>` : ''}` : ''}
  <div class="chart" id="ch-comp"></div>
  ${c ? `
  ${honours ? `<h2 style="font-size:1.05rem">Top honours, ${honours.year}</h2>
  <div class="wrap"><table><thead><tr><th>Award</th><th>Producer</th><th>Cider</th><th>Class</th>
  </tr></thead><tbody>${honours.items.map(r => `<tr>
    <td>${awardLabel(r)}</td>
    <td><a href="#/producer?q=${encodeURIComponent((r.producer && r.producer.n) || '')}">${
      esc((r.producer && r.producer.n) || '')}</a></td>
    <td>${esc(r.entry)}</td><td>${esc(r.category)}</td>
  </tr>`).join('')}</tbody></table></div>
  <p class="note">The trophies of one edition${honours.editions > 1
    ? `. Pick a year to see another of the ${num(honours.editions)} on record` : ''}.</p>` : ''}
  <div class="split">
    ${cats.length ? `<section><h2 style="font-size:1.05rem">What it judges</h2>
      ${countList(cats, 12, 'class')}</section>` : ''}
    ${origins.items.length ? `<section><h2 style="font-size:1.05rem">Where entries come from</h2>
      ${countList(origins.items, 12, origins.label)}
      <p class="note">Producers matched to the World Cider Map, so this is a floor.</p>
      </section>` : ''}
  </div>` : leagueTable()}
  ${resultsTable(!c)}`
  : `<p class="note">No awards match these filters.
     <a href="#/competition${c ? `?comp=${c.id}` : ''}">Clear them</a>.</p>`}`;
}
competition.after = () => {
  const {c, all, rows} = compScope(readState());
  wireFilters();
  medalsByYear(rows, el('ch-comp'), all);
  if (!c) wireLeagueTable(rows);
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

const PRODUCER_CAP = 250;

/** The producer league: who has won what, and where. This is the ranking the
 *  competition page used to carry, which never belonged there - it is about
 *  producers, so it lives with them, and here it can be filtered and sorted. */
function producerRows(rows) {
  const m = new Map();
  for (const r of rows) {
    const name = r.producer && r.producer.n;
    if (!name) continue;
    let t = m.get(name);
    if (!t) {
      t = {name, p: r.producer, awards: 0, comps: new Set(), years: new Set()};
      m.set(name, t);
    }
    t.awards++;
    t[tierOf(r)] = (t[tierOf(r)] || 0) + 1;
    t.comps.add(r.comp.id);
    if (r.year) t.years.add(r.year);
  }
  return [...m.values()].map(t => {
    const ys = [...t.years].sort((a, b) => a - b);
    return {...t, competitions: t.comps.size,
            from: ys[0] || 0, to: ys[ys.length - 1] || 0,
            where: (t.p && (t.p.ct || t.p.r)) || ''};
  }).sort((a, b) => b.awards - a.awards || a.name.localeCompare(b.name));
}

export function producer() {
  const st = readState();
  if (!st.q) {
    const rows = apply(D.rows, {...st, q: ''});
    const tiers = tiersIn(rows);
    const filtered = rows.length !== D.rows.length;
    const heads = ['Producer', 'Awards', ...tiers.map(t => t.label),
                   'Competitions', 'Years', 'Where'];
    return `<h2>Producers</h2>
    <p class="sub">Ranked by awards${filtered ? ' matching these filters' : ''}.
       Every producer in the dataset, including those with no pin on the map.</p>
    ${filterBar(st, {award: false, style: false, place: true, search: false})}
    <div class="filters" style="margin-top:-.4rem">
      <input type="search" id="f-find" placeholder="Find a producer">
      <span class="note" id="prod-count"></span>
    </div>
    ${rows.length ? `<div class="wrap"><table id="prod"><thead><tr>
      ${heads.map((h, i) => `<th data-col="${i}"${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}
    </tr></thead><tbody></tbody></table></div>`
    : `<p class="note">No awards match these filters. <a href="#/producer">Clear them</a>.</p>`}`;
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
  <p class="sub">${esc(place) || 'Location not recorded'}</p>
  ${linkRow(p)}
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
  if (!st.q) { wireFilters(); wireProducerTable(); return; }
  const {all, rows} = prodScope(st);
  wireFilters(all);
  medalsByYear(rows, el('ch-prod'), all);
};

function wireProducerTable() {
  const table = el('prod');
  if (!table) return;
  const st = readState();
  const rows = apply(D.rows, {...st, q: ''});
  const tiers = tiersIn(rows);
  const all = producerRows(rows);
  const body = table.tBodies[0];
  const count = el('prod-count');

  // `find` narrows the whole ranking before it is capped, so a producer far
  // down the list is still reachable by name.
  let shown = all;
  const render = list => {
    shown = list;
    body.innerHTML = list.slice(0, PRODUCER_CAP).map(t => `<tr>
      <td><a href="#/producer?q=${encodeURIComponent(t.name)}">${esc(t.name)}</a></td>
      <td class="n">${num(t.awards)}</td>
      ${tiers.map(x => `<td class="n">${t[x.id] ? num(t[x.id]) : ''}</td>`).join('')}
      <td class="n">${t.competitions}</td>
      <td class="n">${t.from ? (t.from === t.to ? t.from : `${t.from}&ndash;${t.to}`) : ''}</td>
      <td>${esc(t.where)}</td>
    </tr>`).join('');
    if (count) {
      count.textContent = list.length > PRODUCER_CAP
        ? `Showing the top ${PRODUCER_CAP} of ${num(list.length)} producers.`
        : `${num(list.length)} producer${list.length === 1 ? '' : 's'}.`;
    }
  };
  render(all);

  makeSortable(table, () => shown, [t => t.name, t => t.awards,
    ...tiers.map(x => t => t[x.id] || 0),
    t => t.competitions, t => t.from, t => t.where], render);

  const find = el('f-find');
  let timer;
  if (find) find.addEventListener('input', e => {
    clearTimeout(timer);
    const v = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => render(
      v ? all.filter(t => t.name.toLowerCase().includes(v)) : all), 150);
  });
}

let mapObj = null;
// The element MapLibre owns. Every filter change re-renders the view, which
// replaces the page's HTML wholesale - and used to take the map's container
// with it, leaving a live map bound to a discarded node and an empty grey box
// on screen. This node is created once and re-parented into each new slot, so
// the map survives a re-render with its camera and loaded tiles intact.
let mapEl = null;

/** Put the persistent map element inside the freshly rendered slot. */
function mountMap(slot) {
  if (!slot) return null;
  if (!mapEl) {
    mapEl = document.createElement('div');
    mapEl.className = 'map-canvas';
  }
  if (mapEl.parentNode !== slot) slot.replaceChildren(mapEl);
  return mapEl;
}

function drawMap(slotId = 'map') {
  const slot = mountMap(el(slotId));
  if (!slot) return;
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
    // The node may have just been re-parented into a new slot of a different
    // size; MapLibre only learns that when told.
    mapObj.resize();
    frameFeatures(feats);
    return;
  }

  mapObj = new maplibregl.Map({
    container: slot,
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
    frameFeatures(feats);
  });
}

const WORLD = {center: [-30, 42], zoom: 1.4};
let framedFor = null;

/** Move the map to the filtered results, so narrowing to a Breton competition
 *  lands on Brittany rather than leaving three pins in the Atlantic. Keyed on
 *  the filter state, not on every redraw, so panning around afterwards is not
 *  fought; clearing the filters returns to the world view. */
function frameFeatures(feats) {
  if (!mapObj) return;
  const st = readState();
  const key = [st.comp, st.year, st.award, st.style, st.q].join('\u0001');
  if (key === framedFor) return;
  framedFor = key;
  const filtering = Boolean(st.comp || st.year || st.award || st.style || st.q);
  if (!filtering) { mapObj.easeTo({...WORLD, duration: 600}); return; }
  if (!feats.length) return;
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of feats) {
    const [lon, lat] = f.geometry.coordinates;
    if (lon < w) w = lon; if (lon > e) e = lon;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  mapObj.fitBounds([[w, s], [e, n]], {padding: 60, maxZoom: 8, duration: 600});
}

export function teardownMap() {
  // Dropping the reference is not enough: MapLibre holds a live WebGL context
  // and render loop. Without remove() they accumulate on every navigation and
  // slowly choke the renderer.
  if (mapObj) { try { mapObj.remove(); } catch (e) { /* already gone */ } }
  mapObj = null;
  if (mapEl) mapEl.remove();
  mapEl = null;
  // The next map is a new one, so it has not framed anything yet. Without
  // this, coming back to a filtered landing page leaves the world view.
  framedFor = null;
}
