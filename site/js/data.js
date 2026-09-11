// Loads the whole dataset once. ~250KB gzipped, so there is no API and no paging.
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

export const MEDAL_ORDER = ['double_gold','gold','silver','bronze','commended'];
export const MEDAL_LABEL = {double_gold:'Double Gold',gold:'Gold',silver:'Silver',
  bronze:'Bronze',commended:'Commended'};
export const TIER_COLOR = {double_gold:'var(--t1)',gold:'var(--t2)',silver:'var(--t3)',
  bronze:'var(--t4)',commended:'var(--t5)'};

export const titleCase = s => (s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
