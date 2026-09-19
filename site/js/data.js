// Loads the whole dataset once. ~350KB gzipped, so there is no API and no paging.
export const D = { awards:null, producers:null, dims:null, meta:null, rows:null };

export async function load(){
  const get = async f => (await fetch(`data/${f}.json`)).json();
  const [awards, producers, dims, meta] =
    await Promise.all([get('awards'), get('producers'), get('dims'), get('meta')]);
  Object.assign(D, {awards, producers, dims, meta});

  // Materialise a row view once; 18k rows is trivial to filter in memory.
  D.rows = new Array(awards.n);
  for (let i=0;i<awards.n;i++){
    D.rows[i] = {
      i,
      comp: dims.competitions[awards.c[i]],
      year: awards.y[i],
      producer: producers[awards.p[i]],
      style: dims.styles[awards.s[i]] ?? '',
      medal: dims.medals[awards.m[i]] ?? '',
      kind: dims.kinds[awards.k[i]] ?? '',
      special: dims.specials[awards.sp[i]] ?? '',
      category: dims.categories[awards.cat[i]] ?? '',
      entry: awards.e[i],
    };
  }
  return D;
}

// Producer links arrive with their service's shared prefix stripped, since
// storing it 1,500 times would cost more than the links are worth. Only a URL
// that did not match its prefix is stored whole, and only those start with
// http. Keep in step with LINK_PREFIX in pipeline/build.py.
const LINK_PREFIX = {f: 'https://www.facebook.com/', i: 'https://www.instagram.com/',
  g: 'https://maps.google.com/?cid=', u: 'https://untappd.com/',
  y: 'https://www.yelp.com/biz/', t: 'https://www.tripadvisor.com/'};

export const LINK_NAME = {w: 'Website', f: 'Facebook', i: 'Instagram', g: 'Google Maps',
  u: 'Untappd', y: 'Yelp', t: 'TripAdvisor'};

/** Rebuild a producer's links as [key, url] pairs, in display order. */
export function producerLinks(p){
  const lk = (p && p.lk) || {};
  return Object.keys(LINK_NAME)
    .filter(k => lk[k])
    .map(k => [k, lk[k].startsWith('http') ? lk[k] : (LINK_PREFIX[k] || '') + lk[k]]);
}

export const MEDAL_LABEL = {double_gold:'Double Gold',gold:'Gold',silver:'Silver',
  bronze:'Bronze',commended:'Commended'};

// Award tiers. Trophies and nominations (Best in Class, Platinum, Judges' Pick,
// Finalist) carry no medal level at all - 1,572 rows, every Good Food Awards
// row among them - so anything keyed on medal alone drops them silently.
// Tiering on (medal, special) keeps them visible and ranked.
export const TIER_ORDER = ['top','gold','silver','bronze','other'];
export const TIER_COLOR = {top:'var(--t1)',gold:'var(--t2)',silver:'var(--t3)',
  bronze:'var(--t4)',other:'var(--t5)'};

// Specials that outrank a gold medal. Everything else without a medal level
// (judges' picks, finalists, honorable mentions) ranks below bronze.
const ABOVE_GOLD = new Set(['best_in_show','best_of_show','best_in_class','best_of_category',
  'champion','supreme_champion','reserve','platinum','premium','trophy','winner']);

export const tierOf = r =>
  r.medal === 'double_gold' ? 'top'
  : r.medal === 'commended' ? 'other'
  : r.medal ? r.medal
  : ABOVE_GOLD.has(r.special) ? 'top' : 'other';

// The value the award filter stores. Medals filter by level, everything else
// by its own name, so "Best in Class" is selectable where a competition awards it.
export const awardValue = r => r.medal || (r.special ? 'special:' + r.special : '');

// The emoji each award carries on the source spreadsheets, looked up on a
// loosened key: the sheets write "double gold" and "judges' pick" where the
// data says double_gold and judges_pick, so an exact match finds neither and
// those awards used to render with no emoji at all.
const glyphKey = s => (s || '').toLowerCase().replace(/[_'’-]/g, ' ')
  .replace(/\s+/g, ' ').trim();
let glyphs = null;

export function awardGlyph(r){
  if (!glyphs){
    glyphs = new Map();
    for (const [k, v] of Object.entries(D.dims.medal_display || {})){
      if (v) glyphs.set(glyphKey(k), v);
    }
  }
  // The special award names the honour; the medal level is the fallback.
  return glyphs.get(glyphKey(r.special)) || glyphs.get(glyphKey(r.medal)) || '';
}

// Only for names title-casing cannot reach on its own.
const AWARD_NAMES = {judges_pick: "Judges' Pick"};

export const awardName = v => v.startsWith('special:')
  ? (AWARD_NAMES[v.slice(8)] || titleCase(v.slice(8)))
  : (MEDAL_LABEL[v] || titleCase(v));

const tierOfValue = v => v.startsWith('special:')
  ? (ABOVE_GOLD.has(v.slice(8)) ? 'top' : 'other')
  : tierOf({medal: v, special: ''});

/** Award options present in `rows`, ranked. Used to build the dropdown. */
export function awardOptions(rows){
  const present = new Set();
  for (const r of rows){ const v = awardValue(r); if (v) present.add(v); }
  return [...present]
    .map(v => ({value: v, label: awardName(v), tier: tierOfValue(v)}))
    .sort((a,b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
                   || a.label.localeCompare(b.label));
}

/** Name a tier after the awards actually in it, so a chart legend reads
 *  "Best in Class" for GLINTCAP and "Winner" for the Good Food Awards, and
 *  only says "Double Gold" where a Double Gold is really among them. */
export function tierLabel(tier, rows){
  if (tier !== 'top' && tier !== 'other') return MEDAL_LABEL[tier];
  const level = tier === 'top' ? 'Double Gold' : 'Commended';
  const names = new Set();
  let hasLevel = false;
  for (const r of rows){
    if (tierOf(r) !== tier) continue;
    if (r.medal) hasLevel = true; else names.add(awardName(awardValue(r)));
  }
  if (!names.size) return level;                          // just the medal level
  if (names.size === 1 && !hasLevel) return [...names][0];  // just one trophy
  if (tier === 'other') return 'Other awards';
  return hasLevel ? `Trophies & ${level}` : 'Trophies';
}

// Joining words stay lowercase: "Best in Class", not "Best In Class".
const SMALL_WORDS = new Set(['in','of','the','and','a','de','du']);
export const titleCase = s => (s||'').replace(/_/g,' ')
  .replace(/\b[\w']+/g, (w,i) => i && SMALL_WORDS.has(w) ? w : w[0].toUpperCase()+w.slice(1));
export const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
