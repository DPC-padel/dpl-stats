// Run: node stats.test.mjs — checks the numbers the dashboard shows.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { computeStats } = new Function(readFileSync(new URL("stats.js", import.meta.url), "utf8") + "\nreturn { computeStats };")();
const T = 1_800_000_000;
const ev = (dt, vid, sid, page, event, detail = "", src = "instagram", device = "mobile") => [T + dt, vid, sid, page, event, detail, src, device];
const rows = [
  ev(0, "a", "s1", "league", "view"), ev(5, "a", "s1", "league", "click", "hero_register"),
  ev(6, "a", "s1", "register", "view"), ev(10, "a", "s1", "register", "start", "player"),
  ev(20, "a", "s1", "register", "field", "availability"), ev(40, "a", "s1", "register", "field", "name"),
  ev(200, "a", "s1", "register", "submit", "player"), ev(210, "a", "s1", "register", "success", "player"),
  ev(0, "b", "s2", "register", "view", "", "whatsapp"), ev(3, "b", "s2", "register", "start", "player", "whatsapp"),
  ev(9, "b", "s2", "register", "field", "dob", "whatsapp"), ev(12, "b", "s2", "register", "submit", "player", "whatsapp"),
  ev(12, "b", "s2", "register", "invalid", "phone", "whatsapp"),
  ev(0, "c", "s3", "league", "view", "", "direct", "desktop"),
];
const s = computeStats(rows, [{ level: "Intermediate", dob: "1996-05-01" }], new Date(T * 1000));
assert.deepEqual([s.kpi.formVisits, s.kpi.formVisitors, s.kpi.starts, s.kpi.registered, s.kpi.completion, s.kpi.medianSeconds], [2, 2, 2, 1, 50, 200]);
assert.equal(s.kpi.formBounce, 50);                            // b opened the form and left without registering
assert.deepEqual(s.journey.map((f) => f.n), [2, 1, 2, 2, 1, 2, 0, 0, 2, 1]);
assert.deepEqual(s.journey.map((f) => f.lost), [null, 1, -1, 0, 1, -1, 2, 0, -2, 1]);
assert.equal(s.kpi.formVisitors, 2);
assert.deepEqual(s.form.map((f) => f.n), [2, 2, 1, 2, 0, 0, 2, 1]);
assert.equal(s.formLeak.label, "Your padel");                 // 2 → 0, the biggest loss
assert.equal(Math.round(s.kpi.formConversion), 50);
assert.equal(Math.round(s.kpi.leagueBounce), 50);              // c saw the League page and did nothing
assert.equal(s.kpi.errorRate, 50);                             // b's Register press was blocked
assert.deepEqual(s.quit, [{ label: "Date of birth", n: 1, pct: 100, medianSeconds: 9 }]);
assert.deepEqual(s.blocked, { "WhatsApp number": 1 });
assert.deepEqual(s.sources.map((x) => [x.key, x.visits, x.registered]), [["instagram", 1, 1], ["whatsapp", 1, 0]]);
assert.deepEqual(s.who.age, { "25–34": 1 });
console.log("ok");
// A step nobody reached doesn't break the next step's drop-off.
const empty = computeStats([ev(0, "z", "sz", "register", "view")], [], new Date(T * 1000));
assert.deepEqual(empty.form.map((f) => f.lostPct), [null, 100, 0, 0, 0, 0, 0, 0]);
assert.equal(empty.kpi.formBounce, 100);                       // opened the form, touched nothing
console.log("ok: empty steps");
// Entries tab.
const { computeEntries } = new Function(readFileSync(new URL("stats.js", import.meta.url), "utf8") + "\nreturn { computeEntries };")();
const R = (gender, level, availability, at = T) => ({ gender, level, availability, at, tshirt: "M", dob: "1996-05-01" });
const e = computeEntries([
  R("Male", "Beginner", "All days"), R("Male", "Advanced", "Can't play, Sat 21, Sun 29"),
  R("Female", "Beginner", "Only 20–22 Nov"), R("Other", "Intermediate", "Both weekends", T - 30 * 86400),
], new Date(T * 1000));
assert.deepEqual([e.total, e.today, e.week, e.allDays, e.someDays], [4, 3, 3, 2, 2]);
assert.deepEqual(e.grid.rows.find((r) => r.level === "Beginner").cells, [1, 1, 0]);
assert.deepEqual(e.perDay.map((d) => d.n), [4, 3, 4, 3, 2]);
assert.deepEqual(e.gender, { Male: 2, Female: 1, Other: 1 });
console.log("ok: entries");
