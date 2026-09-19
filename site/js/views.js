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
