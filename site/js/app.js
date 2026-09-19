import {load} from './data.js';
import * as views from './views.js';

const ROUTES = {
  '': views.home,
  home: views.home,
  competition: views.competition,
  producer: views.producer,
};

// Views that were folded into others. Explore became the competition page with
// "All competitions" selected; the map became the top of the landing page.
// Old links land there rather than on a 404.
const MOVED = {explore: 'competition', map: ''};

const main = document.getElementById('view');
let current = null;

function route() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (path in MOVED) {
    const qs = location.hash.split('?')[1];
    location.replace(`#/${MOVED[path]}${qs ? '?' + qs : ''}`);
    return;
  }
  const view = ROUTES[path] || views.home;

  // MapLibre holds a live WebGL context and render loop; the landing page is
  // the only view that shows it, so leaving is where it gets released.
  if (current === views.home && view !== views.home) views.teardownMap();
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
