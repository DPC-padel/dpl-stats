// League registration analytics: turns league_events rows (from the DPC site's league/track.js)
// and the registration mix into the numbers the dashboard shows. Pure, no DOM.
// Row: [epochSeconds, vid, sid, page, event, detail, src, device]

const FIELD_LABELS = {
  availability: "Which dates", consent: "Confirm / consent boxes", name: "Full name", phone: "WhatsApp number",
  email: "Email", gender: "Gender", dob: "Date of birth", area: "Where you live", instagram: "Instagram", experience: "How long playing",
  level: "Self rating", side: "Preferred side", tournament: "Tournament result", tshirt: "T-shirt size",
};
// Form order (league/register/index.html): a step counts sessions that answered any of its questions.
const STEPS = [
  ["The dates", ["availability"]],
  ["Your details", ["name", "phone", "email", "gender", "dob", "area", "instagram"]],
  ["Your padel", ["experience", "level", "side", "tournament"]],
  ["Your kit", ["tshirt"]],
];
const REGISTER_CLICKS = new Set(["hero_register", "path_play", "register_link"]);
const IST = 19800;   // India is UTC+5:30

const median = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };

function computeStats(rows, regs, now) {
  const S = new Map();   // sid → session summary
  for (const [t, vid, sid, page, event, detail, src, device] of rows) {
    let s = S.get(sid);
    if (!s) S.set(sid, s = { vid, src: src || "direct", device: device || "unknown", pages: new Set(), fields: [], first: t, last: t,
      clicked: false, clickedRegister: false, start: 0, submit: false, invalid: false, success: 0, scroll: 0, partnerStart: false, partnerSent: false });
    s.last = t;
    if (event === "view") s.pages.add(page);
    if (event === "click") { s.clicked = true; if (REGISTER_CLICKS.has(detail)) s.clickedRegister = true; }
    if (event === "scroll") s.scroll = Math.max(s.scroll, Number(detail) || 0);
    if (event === "start") { if (detail === "sponsor") s.partnerStart = true; else if (!s.start) s.start = t; }
    if (event === "field" && FIELD_LABELS[detail]) s.fields.push(detail);
    if (event === "submit" && detail === "player") s.submit = true;
    if (event === "invalid") s.invalid = true;
    if (event === "success") { if (detail === "sponsor") s.partnerSent = true; else if (!s.success) s.success = t; }
  }
  const sessions = [...S.values()];
  const count = (f, list = sessions) => list.filter(f).length;
  const uniq = (list) => new Set(list.map((s) => s.vid)).size;
  const pct = (a, b) => (b ? (100 * a) / b : 0);

  const formSessions = sessions.filter((s) => s.pages.has("register"));
  const formVisitors = uniq(formSessions);
  const starts = count((s) => s.start);
  const registered = count((s) => s.success);
  const leagueSessions = sessions.filter((s) => s.pages.has("league"));

  // Funnel, with how many each step lost from the one before it.
  const steps = (list) => [
    ["Started form", count((s) => s.start, list)],
    ...STEPS.map(([label, names]) => [label, count((s) => s.fields.some((f) => names.includes(f)), list)]),
    ["Pressed Register", count((s) => s.submit, list)],
    ["Registered", count((s) => s.success, list)],
  ];
  const withLoss = (pairs, base) => pairs.map(([label, n], i) => {
    const prev = i ? pairs[i - 1][1] : null;
    return { label, n, pct: pct(n, base), lost: prev == null ? null : prev - n, lostPct: prev == null ? null : pct(prev - n, prev) };
  });
  const journey = withLoss([
    ["League page", leagueSessions.length],
    ["Clicked Register", count((s) => s.clickedRegister)],
    ["Form page", formSessions.length],
    ...steps(sessions),
  ], sessions.length);
  const form = withLoss([["Form page", formSessions.length], ...steps(formSessions)], formSessions.length);
  const leak = (f) => f.reduce((m, x) => (x.lost > 0 && x.lostPct > (m ? m.lostPct : -1) ? x : m), null);

  // Where people quit: last question answered (and time spent) in sessions that started but didn't register.
  const quit = {};
  sessions.filter((s) => s.start && !s.success).forEach((s) => {
    const k = s.fields.length ? FIELD_LABELS[s.fields[s.fields.length - 1]] : "Opened, answered nothing";
    (quit[k] = quit[k] || []).push(s.last - s.start);
  });
  const abandoned = Object.values(quit).reduce((a, b) => a + b.length, 0);

  const tally = (pick) => { const o = {}; rows.forEach((r) => { const k = pick(r); if (k) o[k] = (o[k] || 0) + 1; }); return o; };

  // Form visits by source / device.
  const groupBy = (key) => {
    const g = {};
    formSessions.forEach((s) => (g[s[key]] = g[s[key]] || []).push(s));
    return Object.entries(g).map(([k, list]) => {
      const u = uniq(list), st = count((s) => s.start, list), rg = count((s) => s.success, list);
      return { key: k, visits: list.length, visitors: u, starts: st, registered: rg, conv: pct(rg, u) };
    }).sort((a, b) => b.visits - a.visits);
  };

  // People who came back to the form, and how long from first opening it to registering.
  const byVid = {};
  formSessions.forEach((s) => (byVid[s.vid] = byVid[s.vid] || []).push(s));
  const people = Object.values(byVid);
  const returning = people.filter((p) => p.length > 1);
  const toRegister = people.map((p) => { const won = p.find((s) => s.success); return won ? won.success - Math.min(...p.map((s) => s.first)) : null; });

  // Daily and by hour, in India time.
  const day = (t) => new Date((t + IST) * 1000).toISOString().slice(0, 10);
  const hour = (t) => new Date((t + IST) * 1000).getUTCHours();
  const days = {};
  const d = (k) => (days[k] = days[k] || { visits: 0, vids: new Set(), starts: 0, registered: 0 });
  formSessions.forEach((s) => { const x = d(day(s.first)); x.visits++; x.vids.add(s.vid); if (s.start) x.starts++; if (s.success) x.registered++; });
  const daily = Object.keys(days).sort().map((k) => ({ day: k, visits: days[k].visits, visitors: days[k].vids.size, starts: days[k].starts, registered: days[k].registered }));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, visits: 0, registered: 0 }));
  formSessions.forEach((s) => { hours[hour(s.first)].visits++; if (s.success) hours[hour(s.success)].registered++; });

  // Who's registering, from the registrations themselves.
  const mix = (k) => { const o = {}; regs.forEach((r) => { const v = r[k] || "—"; o[v] = (o[v] || 0) + 1; }); return o; };
  const ages = {};
  regs.forEach((r) => {
    const b = r.dob ? new Date(r.dob) : null;
    const age = b && !isNaN(b) ? Math.floor((now - b) / 31557600000) : null;
    const band = age == null ? "—" : age < 25 ? "Under 25" : age < 35 ? "25–34" : age < 45 ? "35–44" : "45+";
    ages[band] = (ages[band] || 0) + 1;
  });
  const submitted = count((s) => s.submit);
  const scrolled = (n) => count((s) => s.scroll >= n, leagueSessions);

  return {
    kpi: {
      // The form: visits (every opening), visitors (each person once), bounce (opened it, left without registering).
      formVisits: formSessions.length, formVisitors, starts, registered, abandoned,
      formConversion: pct(registered, formVisitors), completion: pct(registered, starts),
      formBounce: pct(count((s) => !s.success, formSessions), formSessions.length),
      leftBeforeStarting: count((s) => !s.start, formSessions),
      // League page, for context.
      leagueVisitors: uniq(leagueSessions), leagueBounce: pct(count((s) => !s.clicked && !s.pages.has("register"), leagueSessions), leagueSessions.length),
      errorRate: pct(count((s) => s.submit && s.invalid), submitted),
      returning: pct(returning.length, people.length), returningConv: pct(returning.filter((p) => p.some((s) => s.success)).length, returning.length),
      medianSeconds: median(sessions.filter((s) => s.start && s.success > s.start).map((s) => s.success - s.start)),
      toRegisterSeconds: median(toRegister),
      partnerStarts: count((s) => s.partnerStart), partnerSent: count((s) => s.partnerSent), totalRegs: regs.length,
    },
    journey, form, journeyLeak: leak(journey.slice(1)), formLeak: leak(form),
    quit: Object.entries(quit).sort((a, b) => b[1].length - a[1].length)
      .map(([label, ts]) => ({ label, n: ts.length, pct: pct(ts.length, abandoned), medianSeconds: median(ts) })),
    blocked: tally((r) => r[4] === "invalid" && (FIELD_LABELS[r[5]] || r[5])),
    errors: tally((r) => r[4] === "error" && r[5]),
    clicks: tally((r) => r[4] === "click" && r[5]),
    scroll: leagueSessions.length ? [25, 50, 75, 100].map((n) => ({ label: n + "%", n: scrolled(n), pct: pct(scrolled(n), leagueSessions.length) })) : [],
    sources: groupBy("src"), devices: groupBy("device"), daily, hours,
    cumulative: regs.filter((r) => r.at).map((r, i) => ({ day: day(r.at), total: i + 1 })),
    who: { level: mix("level"), gender: mix("gender"), availability: mix("availability"), experience: mix("experience"), age: ages },
  };
}

// ── Entries tab: who has registered, from the saved registrations. ──
const MATCH_DAYS = [["Fri 20", "Fri 20 Nov"], ["Sat 21", "Sat 21 Nov"], ["Sun 22", "Sun 22 Nov"], ["Sat 28", "Sat 28 Nov"], ["Sun 29", "Sun 29 Nov"]];
const LEVELS = ["Beginner", "Lower Intermediate", "Intermediate", "Advanced"];
const GENDERS = ["Male", "Female", "Other"];

// Which of the five match days someone can play, from any version of the form's answer.
function canPlay(a) {
  a = String(a || "");
  if (/^(All days|Both weekends)/.test(a)) return MATCH_DAYS.map(() => true);
  if (/^Only 20/.test(a)) return [true, true, true, false, false];
  if (/^Only 28/.test(a)) return [false, false, false, true, true];
  if (/^Can't play/.test(a)) return MATCH_DAYS.map(([k]) => !a.includes(k));
  if (/^Neither/.test(a)) return MATCH_DAYS.map(() => false);
  return null;   // blank or unknown answer
}
function ageBand(dob, now) {
  const b = dob ? new Date(dob) : null;
  const age = b && !isNaN(b) ? Math.floor((now - b) / 31557600000) : null;
  return age == null ? "—" : age < 25 ? "Under 25" : age < 35 ? "25–34" : age < 45 ? "35–44" : "45+";
}

function computeEntries(regs, now) {
  const nowS = now / 1000, day = (t) => new Date((t + IST) * 1000).toISOString().slice(0, 10), today = day(nowS);
  const count = (f) => regs.filter(f).length;
  const tally = (pick, order = []) => {
    const o = {};
    order.forEach((k) => (o[k] = 0));
    regs.forEach((r) => { const k = pick(r) || "—"; o[k] = (o[k] || 0) + 1; });
    return o;
  };
  // Category grid: level × gender.
  const levels = [...LEVELS, ...new Set(regs.map((r) => r.level || "—").filter((l) => !LEVELS.includes(l)))];
  const genders = [...GENDERS, ...new Set(regs.map((r) => r.gender || "—").filter((g) => !GENDERS.includes(g)))];
  const grid = levels.map((l) => ({ level: l, cells: genders.map((g) => count((r) => (r.level || "—") === l && (r.gender || "—") === g)), total: count((r) => (r.level || "—") === l) }));
  const plays = regs.map((r) => canPlay(r.availability));
  const daily = {};
  regs.forEach((r) => { if (r.at) daily[day(r.at)] = (daily[day(r.at)] || 0) + 1; });
  return {
    total: regs.length,
    today: count((r) => r.at && day(r.at) === today),
    week: count((r) => r.at && r.at >= nowS - 7 * 86400),
    gender: tally((r) => r.gender, GENDERS),
    allDays: plays.filter((p) => p && p.every(Boolean)).length,
    someDays: plays.filter((p) => p && !p.every(Boolean)).length,
    grid: { genders, rows: grid, totals: genders.map((g) => count((r) => (r.gender || "—") === g)) },
    perDay: MATCH_DAYS.map(([, label], i) => ({ label, n: plays.filter((p) => p && p[i]).length })),
    level: tally((r) => r.level, LEVELS), experience: tally((r) => r.experience), side: tally((r) => r.side),
    tshirt: tally((r) => r.tshirt, ["S", "M", "L", "XL", "XXL"]), age: tally((r) => ageBand(r.dob, now), ["Under 25", "25–34", "35–44", "45+"]),
    daily: Object.keys(daily).sort().map((k) => ({ day: k, n: daily[k] })),
  };
}
