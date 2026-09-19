// Filter state lives in the URL hash, so every view is shareable - the thing
// Tableau Public is worst at.
export function readState(){
  const q = new URLSearchParams((location.hash.split('?')[1])||'');
  // `medal` is the old name for `award`, kept so links shared before trophies
  // became selectable still resolve.
  return {comp:q.get('comp')||'', year:q.get('year')||'',
          award:q.get('award')||q.get('medal')||'',
          style:q.get('style')||'',
          country:q.get('country')||'', region:q.get('region')||'',
          q:q.get('q')||''};
}
export function writeState(patch){
  const [path, qs] = location.hash.replace(/^#\/?/,'').split('?');
  const q = new URLSearchParams(qs||'');
  for (const [k,v] of Object.entries(patch)) v ? q.set(k,v) : q.delete(k);
  if ('award' in patch) q.delete('medal');   // never carry both spellings
  const s = q.toString();
  location.hash = `#/${path}${s?'?'+s:''}`;
}
export const matchesAward = (r, award) => !award
  || (award.startsWith('special:') ? r.special === award.slice(8) : r.medal === award);

export function apply(rows, st){
  const needle = st.q.toLowerCase();
  return rows.filter(r =>
    (!st.comp  || r.comp.id === st.comp) &&
    (!st.year  || r.year === +st.year) &&
    matchesAward(r, st.award) &&
    (!st.style || r.style === st.style) &&
    (!st.country || (r.producer && r.producer.ct === st.country)) &&
    (!st.region  || (r.producer && r.producer.r === st.region)) &&
    (!needle   || (r.producer?.n||'').toLowerCase().includes(needle)
               || (r.entry||'').toLowerCase().includes(needle)));
}
