// Filter state lives in the URL hash, so every view is shareable - the thing
// Tableau Public is worst at.
export function readState(){
  const q = new URLSearchParams((location.hash.split('?')[1])||'');
  return {comp:q.get('comp')||'', year:q.get('year')||'', medal:q.get('medal')||'',
          style:q.get('style')||'', q:q.get('q')||''};
}
export function writeState(patch){
  const [path, qs] = location.hash.replace(/^#\/?/,'').split('?');
  const q = new URLSearchParams(qs||'');
  for (const [k,v] of Object.entries(patch)) v ? q.set(k,v) : q.delete(k);
  const s = q.toString();
  location.hash = `#/${path}${s?'?'+s:''}`;
}
export function apply(rows, st){
  const needle = st.q.toLowerCase();
  return rows.filter(r =>
    (!st.comp  || r.comp.id === st.comp) &&
    (!st.year  || r.year === +st.year) &&
    (!st.medal || r.medal === st.medal) &&
    (!st.style || r.style === st.style) &&
    (!needle   || (r.producer?.n||'').toLowerCase().includes(needle)
               || (r.entry||'').toLowerCase().includes(needle)));
}
