import {load} from './data.js';
import * as views from './views.js';

const ROUTES = {
  '': views.home,
  home: views.home,
  map: views.map,
  competition: views.competition,
  producer: views.producer,
  explore: views.explore,
};

const main = document.getElementById('view');
let current = null;

function route() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  const view = ROUTES[path] || views.home;

  // MapLibre holds a canvas tied to a DOM node that we are about to replace.
  if (current === views.map && view !== views.map) views.teardownMap();
  current = view;

  document.querySelectorAll('nav a').forEach(a => {
    const target = a.getAttribute('href').replace(/^#\/?/, '').split('?')[0];
    a.classList.toggle('on', target === path || (!path && target === ''));
  });

  main.innerHTML = view();
  if (view.after) view.after();
  window.scrollTo(0, 0);
}

load().then(() => {
  window.addEventListener('hashchange', route);
  route();
}).catch(err => {
  main.innerHTML = `<h2>Could not load the data</h2>
    <p class="sub">${err}</p>
    <p class="note">If you opened this file directly, serve it over HTTP instead:
    <code>python -m http.server</code> from the <code>site/</code> directory.</p>`;
});
