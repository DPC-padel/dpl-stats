# DPL registration analytics

Dashboard for the Delhi Padel League registration form. The League page and form
(padelcollectiveindia.com/league/) send anonymous events to Supabase `league_events`;
this page reads them through `league_stats(password, since)`, behind the Games admin password.

- `index.html` — the dashboard
- `stats.js` — turns events into the numbers (check: `node stats.test.mjs`)
- `style.css`, `crest.jpg` — League look, copied from the DPC site
