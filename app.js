/* Diwali'26 Product Performance dashboard
 * Reads two published Google Sheet CSVs and joins them on SKU (Design Code).
 *   IMG sheet  : SKU | File Name | File ID | Direct Image URL
 *   DATA sheet : SKU | Variant | Product Name | Order Qty | Inward Qty (shown as Production Qty) | Sale Qty
 *                | Inward Date | Remarks | 10 Days | 20 Days | 30 Days | Above 30 Days (sale-window columns)
 * One card per Variant (column B), so colours of the same design sit side by side.
 */
const CONFIG = {
  IMG_CSV:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPpb5TKk-gVY8zKWu58hoKrPQ1bBVYvLs1fy6RclLbFvcei6WN4AjIqiH1OrEnry0oz3Ya9QiLyZ-L/pub?gid=0&single=true&output=csv",
  DATA_CSV:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPpb5TKk-gVY8zKWu58hoKrPQ1bBVYvLs1fy6RclLbFvcei6WN4AjIqiH1OrEnry0oz3Ya9QiLyZ-L/pub?gid=1180891349&single=true&output=csv",
  // Achievement colour bands (Sale ÷ Inward)
  GOOD: 30,
  AVG: 10,
  WINDOWS: [10, 20, 30, Infinity],   // periods: 0–10, 11–20, 21–30, above 30 days
  SUMMARY_CSV:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPpb5TKk-gVY8zKWu58hoKrPQ1bBVYvLs1fy6RclLbFvcei6WN4AjIqiH1OrEnry0oz3Ya9QiLyZ-L/pub?gid=736789929&single=true&output=csv",
  // If a 2026 Product name differs from the 2025 category, map it here, e.g. "ANARKALI DRESS": "ANARKALI"
  SUMMARY_ALIASES: {},
  TIMEOUT_SEC: 90,  // give up waiting for Google after this many seconds

  /* ---------- Rating framework ----------
   * Score 0–100 per colour, 50 = exactly the category benchmark.
   *   Sell-through pace : Sale ÷ Production, per 30 days since inward   (weight 40%)
   *   Velocity          : units sold per day since inward               (weight 35%)
   *   Volume            : total units sold                              (weight 25%)
   * Each part = (value ÷ category benchmark), capped at 2× → 0–100.
   * Benchmarks = median of the same category (Product column); categories with fewer than
   * BENCH_MIN_STYLES rated colours use the all-category median. Fixed values can be set below. */
  RATING: {
    WEIGHTS: { pace: 0.40, vel: 0.35, vol: 0.25 },
    FAST: 65,            // score ≥ 65 → Fast
    STEADY: 40,          // score 40–64 → Steady, below → Slow
    MIN_DAYS: 7,         // fewer days since inward → Too early
    MIN_UNITS: 20,       // a colour must sell at least this many (and ≥ 30% of category median) to be Fast
    BENCH_MIN_STYLES: 5,
    // Optional fixed benchmarks per category (Product name in CAPITALS), e.g.
    // "ANARKALI": { pace: 25, vel: 3, vol: 80 }   pace = sell-through % per 30 days
    CATEGORY_BENCH: {},
  },
};

// Colour-code suffix → swatch (approximate, for the variant dots)
const COLOR_MAP = {
  MST: ["Mustard", "#d4a017"], GRN: ["Green", "#2e8b57"], PUR: ["Purple", "#6a2c91"],
  MEJ: ["Magenta", "#b0306e"], MGN: ["Magenta", "#c2185b"], PNK: ["Pink", "#e88aa8"],
  MRN: ["Maroon", "#7b1e2b"], PEA: ["Peach", "#f5b895"], RST: ["Rust", "#b7410e"],
  OWT: ["Off White", "#f4efe3"], TUR: ["Turquoise", "#30b5b0"], BLK: ["Black", "#222"],
  BRN: ["Brown", "#7a4b2a"], LMY: ["Lemon Yellow", "#f2e15c"], BEG: ["Beige", "#d9c4a0"],
  RED: ["Red", "#c62828"], BLU: ["Blue", "#2f5fb3"], WNE: ["Wine", "#6d1a36"],
  LAV: ["Lavender", "#b9a3d9"], NVY: ["Navy", "#1f2f5c"], OGR: ["Olive Green", "#6b7a2e"],
  YLW: ["Yellow", "#f2c12e"],
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("en-IN");
let DESIGNS = [];

/* ---------- CSV ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Turn rows into objects using the first row that contains "SKU" as the header
function toObjects(rows) {
  const KEYS = ["SKU", "VARIANT", "DESIGN CODE", "FILE NAME", "FILE ID", "CATEGORY"];
  const h = rows.findIndex((r) => r.some((c) => KEYS.includes(c.trim().toUpperCase())));
  if (h < 0) return [];
  const head = rows[h].map((c) => c.trim().toLowerCase());
  return rows.slice(h + 1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const o = {};
      head.forEach((k, i) => (o[k] = (r[i] || "").trim()));
      return o;
    });
}

const pick = (o, ...keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== "") return o[k];
  return "";
};
const num = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
};

function fmtDate(v) {
  if (!v) return "";
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(+v) * 86400000);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  }
  return v;
}

function driveId(o) {
  const id = pick(o, "file id", "fileid", "id");
  if (id) return id;
  const url = pick(o, "direct image url", "image url", "url");
  const m = url.match(/[?&]id=([\w-]+)/) || url.match(/\/d\/([\w-]+)/);
  return m ? m[1] : "";
}

/* ---------- Dates ---------- */
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDate(v) {
  v = String(v || "").trim();
  if (!v) return null;
  let m;
  if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Math.round(+v) * 86400000);
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  if ((m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) {           // dd/mm/yyyy (India)
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, m[2] - 1, +m[1]));
  }
  if ((m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{2,4})/))) {  // 8-Sep-2026
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, MONTHS[m[2].toLowerCase()], +m[1]));
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
const showDate = (d) => d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const todayUTC = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); };

// Finds a sale-window column such as "30 Days", "30D", "Sale 30 Days", "30 Days Sale"
function windowValue(o, n) {
  const last = CONFIG.WINDOWS.filter(isFinite).slice(-1)[0];
  for (const k of Object.keys(o)) {
    const c = k.replace(/[\s_]/g, "");
    if (n === Infinity) {   // "Above 30 Days", "30+ Days", ">30 Days", "Over 30 Days", "30 Days Above"
      if (new RegExp(`^((above|over|after|>)${last}(d|day|days)|${last}\\+(d|day|days)|${last}(d|day|days)(above|\\+))(sale|sales)?(qty)?$`).test(c))
        return o[k] === "" ? null : num(o[k]);
      continue;
    }
    if (new RegExp(`^(sale|sales)?${n}(d|day|days)(sale|sales)?(qty)?$`).test(c)) return o[k] === "" ? null : num(o[k]);
  }
  return undefined; // column not present
}

/* Image match: exact colour code (AND26710426MST) → design code (AND26710426) → closest code */
function findImg(map, variant, sku) {
  if (map[variant]) return map[variant];
  if (map[sku]) return map[sku];
  const k = Object.keys(map).find((x) => variant.startsWith(x) || x.startsWith(sku));
  return k ? map[k] : null;
}

/* ---------- Build ---------- */
let HAS_WINDOWS = false;
function build(imgRows, dataRows) {
  const imgMap = {};
  imgRows.forEach((o) => {
    // key = Design Code / SKU column, or the file name without ".jpg" – with or without colour code
    const key = (pick(o, "variant", "design code", "sku", "file name", "filename") || "")
      .toUpperCase().replace(/\.(JPE?G|PNG|WEBP|GIF)$/, "").replace(/\s+/g, "");
    if (!key) return;
    const sku = key;
    const id = driveId(o);
    imgMap[sku] = {
      // several Drive address types – if one is blocked or rate-limited the next is tried
      srcs: (id ? [
        `https://lh3.googleusercontent.com/d/${id}=w600`,
        `https://drive.google.com/thumbnail?id=${id}&sz=w600`,
        `https://drive.usercontent.google.com/download?id=${id}&export=view`,
      ] : []).concat(pick(o, "direct image url") ? [pick(o, "direct image url")] : []),
      big: id ? `https://lh3.googleusercontent.com/d/${id}=w1600` : pick(o, "direct image url"),
    };
  });

  HAS_WINDOWS = false;
  DESIGNS = [];
  dataRows.forEach((o) => {
    const sku = pick(o, "sku", "design code").toUpperCase();
    if (!sku) return;
    const variant = (pick(o, "variant") || sku).toUpperCase();
    const suffix = variant.startsWith(sku) ? variant.slice(sku.length) : "";
    const order = num(pick(o, "order qty", "order"));
    const prod = num(pick(o, "production qty", "inward qty", "inward"));
    const sale = num(pick(o, "sale qty", "sale", "sales qty"));
    const date = parseDate(pick(o, "inward date", "production date"));
    const days = date ? Math.floor((todayUTC() - date.getTime()) / 86400000) : null;
    const win = CONFIG.WINDOWS.map((n) => {
      const v = windowValue(o, n);
      if (v !== undefined) HAS_WINDOWS = true;
      return { n, v: v === undefined ? null : v, done: days !== null && days >= n };
    });
    const ach = prod ? (sale / prod) * 100 : null;
    DESIGNS.push({
      sku, variant, suffix, order, prod, sale, date, days, win, ach,
      prodPct: order ? (prod / order) * 100 : 0,
      status: ach === null ? "pending" : ach >= CONFIG.GOOD ? "good" : ach >= CONFIG.AVG ? "avg" : "low",
      product: pick(o, "product name", "product", "item name", "style name"),
      remark: pick(o, "remarks", "remark"),
      mrp: pick(o, "mrp", "mrp (rs)", "mrp rs", "price"),
      designer: pick(o, "designer name", "designer", "designer's name"),
      // Category = Product column (C) of the Data sheet; falls back to the code prefix (KUR, AND…) if blank
      cat: (pick(o, "product name", "product", "item name", "style name") || sku.replace(/\d.*$/, "")).trim().toUpperCase(),
      img: findImg(imgMap, variant, sku),
    });
  });

  // how many colours each design has (for the "1 of 2 colours" label)
  const per = {};
  DESIGNS.forEach((d) => (per[d.sku] = (per[d.sku] || 0) + 1));
  const seen = {};
  DESIGNS.forEach((d) => { d.nCol = per[d.sku]; d.iCol = (seen[d.sku] = (seen[d.sku] || 0) + 1); });

  const skus = new Set(DESIGNS.map((d) => d.sku));
  const noImg = DESIGNS.filter((d) => !d.img).length;
  const used = new Set(DESIGNS.map((d) => d.img).filter(Boolean));
  const imgOnly = Object.values(imgMap).filter((m) => !used.has(m)).length;
  $("foot").textContent =
    `${skus.size} designs · ${DESIGNS.length} colour variants · ${noImg} colour cards without image` +
    (imgOnly ? ` · ${imgOnly} images with no data row` : "") +
    ` · Sale Ach % = Sale Qty ÷ Production Qty · Day windows count from Inward Date`;

  const prev = $("catFilter").value;
  const cats = [...new Set(DESIGNS.map((d) => d.cat))].filter(Boolean).sort();
  $("catFilter").innerHTML = `<option value="">All Categories</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (cats.includes(prev)) $("catFilter").value = prev;   // keep the choice after Refresh
  computeRatings();
}

/* ---------- Rating ---------- */
const RATING_LABEL = { fast: "Fast", steady: "Steady", slow: "Slow", early: "Too early" };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
let BENCH = {};

function metricsOf(d) {
  const R = CONFIG.RATING;
  if (!d.date || !d.prod || d.days === null || d.days < R.MIN_DAYS) return null;
  const days = Math.max(d.days, 1);
  const st = (d.sale / d.prod) * 100;
  return { st, pace: (st / days) * 30, vel: d.sale / days, vol: d.sale, days };
}

function computeRatings() {
  const R = CONFIG.RATING;
  DESIGNS.forEach((d) => (d.m = metricsOf(d)));
  const rated = DESIGNS.filter((d) => d.m);
  const benchOf = (list) => ({
    pace: Math.max(median(list.map((d) => d.m.pace)), 1),
    vel: Math.max(median(list.map((d) => d.m.vel)), 0.1),
    vol: Math.max(median(list.map((d) => d.m.vol)), 1),
    n: list.length,
  });
  const all = benchOf(rated);
  BENCH = { __ALL__: { ...all, src: "all categories" } };
  [...new Set(DESIGNS.map((d) => d.cat))].forEach((cat) => {
    const own = rated.filter((d) => d.cat === cat);
    const fixed = R.CATEGORY_BENCH[cat];
    BENCH[cat] = fixed ? { ...all, ...fixed, n: own.length, src: "fixed" }
      : own.length >= R.BENCH_MIN_STYLES ? { ...benchOf(own), src: "category" }
      : { ...all, n: own.length, src: "all categories" };
  });

  DESIGNS.forEach((d) => {
    const b = BENCH[d.cat] || BENCH.__ALL__;
    if (!d.m) { d.rating = { key: "early", label: RATING_LABEL.early, score: null, b }; return; }
    const part = (v, bv) => Math.min(v / bv, 2) * 50;
    const p = { pace: part(d.m.pace, b.pace), vel: part(d.m.vel, b.vel), vol: part(d.m.vol, b.vol) };
    const W = R.WEIGHTS;
    const score = Math.round(p.pace * W.pace + p.vel * W.vel + p.vol * W.vol);
    const smallBatch = d.m.vol < Math.max(R.MIN_UNITS, 0.3 * b.vol);
    let key = score >= R.FAST ? "fast" : score >= R.STEADY ? "steady" : "slow";
    if (key === "fast" && smallBatch) key = "steady";        // small batches can't be heroes
    d.rating = { key, label: RATING_LABEL[key], score, p, b, smallBatch };
  });
}

// Style (all colours) rating = production-weighted average of colour scores
function groupRating(items) {
  const r = items.filter((d) => d.rating && d.rating.score !== null);
  if (!r.length) return { key: "early", label: RATING_LABEL.early, score: null };
  const w = r.reduce((a, d) => a + d.prod, 0) || r.length;
  const score = Math.round(r.reduce((a, d) => a + d.rating.score * (d.prod || 1), 0) / w);
  let key = score >= CONFIG.RATING.FAST ? "fast" : score >= CONFIG.RATING.STEADY ? "steady" : "slow";
  if (key === "fast" && r.every((d) => d.rating.smallBatch)) key = "steady";
  return { key, label: RATING_LABEL[key], score };
}

function ratingTag(r) {
  const tip = r.key === "early" ? "Too early: less than " + CONFIG.RATING.MIN_DAYS + " days since inward, or not inwarded / no production"
    : "Rated on sell-through pace, velocity and volume vs the category benchmark";
  return `<span class="tag r-${r.key}" title="${tip}">${r.label}</span>`;
}

function ratingRow(d) {
  const r = d.rating;
  if (!r || r.score === null) {
    return `<div class="rate early"><span class="rate-h">Rating</span><span class="rate-note">Too early to rate – ${
      !d.date ? "not inwarded yet" : !d.prod ? "no production" : `day ${d.days} of ${CONFIG.RATING.MIN_DAYS}`}</span></div>`;
  }
  const chip = (lbl, v, bv, unit, dec) => {
    const up = v >= bv;
    return `<span class="chip ${up ? "up" : "down"}" title="Category benchmark ${bv.toFixed(dec)}${unit}">
      ${lbl} <b>${v.toFixed(dec)}${unit}</b> <i>${up ? "▲" : "▼"} vs ${bv.toFixed(dec)}${unit}</i></span>`;
  };
  return `<div class="rate">
      <span class="rate-h">Rating vs ${r.b.src === "category" ? esc(d.cat) : r.b.src === "fixed" ? esc(d.cat) + " (fixed)" : "all categories"}</span>
      <div class="chips">
        ${chip("Sell-through/30d", d.m.pace, r.b.pace, "%", 0)}
        ${chip("Velocity", d.m.vel, r.b.vel, "/day", 1)}
        ${chip("Volume", d.m.vol, r.b.vol, "", 0)}
      </div>
      ${r.smallBatch && r.score >= CONFIG.RATING.FAST ? `<span class="rate-note">Small batch – held at Steady</span>` : ""}
    </div>`;
}

/* ---------- Render ---------- */
function achColor(a) {
  if (a === null) return "var(--grey)";
  return a >= CONFIG.GOOD ? "var(--green)" : a >= CONFIG.AVG ? "var(--amber)" : "var(--red)";
}

// Small bar chart: sale in first 30 / 60 / 90 / 120 days after Inward Date
// "2499" / "₹2,499" / "Rs 2499" → "₹2,499"; anything non-numeric is shown as typed
const fmtMRP = (v) => { const n = num(v); return n ? "₹" + n.toLocaleString("en-IN") : esc(v); };

const periodLabel = (from, n) => (n === Infinity ? `Above ${from - 1} days` : `${from}–${n} days`);

function windowChart(d) {
  if (!HAS_WINDOWS) {
    return `<div class="win"><div class="win-h">Sale trend since Inward</div>
      <p class="win-note">Add <b>10 Days · 20 Days · 30 Days · Above 30 Days</b> columns to the Data sheet to see this chart.</p></div>`;
  }
  if (!d.date) {
    return `<div class="win"><div class="win-h">Sale trend since Inward</div><p class="win-note">No Inward Date yet.</p></div>`;
  }
  // Cumulative sale line: Day 0 → 30 → 60 → 90 → 120 (stops at today for a running period)
  const pts = [{ day: 0, cum: 0, add: 0 }];
  let cum = 0, prev = 0;
  for (const w of d.win) {
    if (d.days < prev + 1 && !(w.v > 0)) break;           // period not started yet
    cum += w.v || 0;
    const day = w.done ? w.n : Math.min(Math.max(d.days, prev + 1), w.n);
    pts.push({ day, cum, add: w.v || 0, running: !w.done, n: w.n, from: prev ? prev + 1 : 0 });
    prev = w.n;
    if (!w.done) break;
  }
  const inWin = cum;
  const gapQty = d.sale - inWin;                            // total sale not covered by the day buckets

  // Trend of sale per period (not cumulative): one point per 30-day period, at its centre
  const W = 300, H = 120, L = 10, R = 10, T = 20, B = 24;
  const per = pts.slice(1);
  const maxY = Math.max(1, ...per.map((p) => p.add)) * 1.25;
  const slotW = (W - L - R) / 4;
  const X = (i) => L + slotW * i + slotW / 2;
  const Y = (v) => T + (1 - v / maxY) * (H - T - B);

  const slots = CONFIG.WINDOWS.map((n, i) => {
    const from = i ? CONFIG.WINDOWS[i - 1] + 1 : 0;
    const started = i < per.length;
    return `
      ${i ? `<line x1="${L + slotW * i}" y1="${T - 6}" x2="${L + slotW * i}" y2="${H - B}" class="tl-grid"/>` : ""}
      ${started ? "" : `<rect x="${L + slotW * i}" y="${T - 6}" width="${slotW}" height="${H - B - T + 6}" class="tl-future"/>
        <text x="${X(i)}" y="${(T + H - B) / 2}" class="tl-soon">upcoming</text>`}
      <text x="${X(i)}" y="${H - B + 14}" class="tl-x">${periodLabel(from, n)}</text>`;
  }).join("");
  const path = per.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.add).toFixed(1)}`).join(" ");
  const area = per.length > 1 ? `${path} L${X(per.length - 1).toFixed(1)},${Y(0)} L${X(0).toFixed(1)},${Y(0)} Z` : "";
  const dots = per.map((p, i) => `
      <circle cx="${X(i)}" cy="${Y(p.add)}" r="4.5" class="${p.running ? "tl-dot run" : "tl-dot"}"/>
      <text x="${X(i)}" y="${Y(p.add) - 9}" class="tl-v">${fmt(p.add)}</text>`).join("");
  const svgBody = `${slots}<line x1="${L}" y1="${Y(0)}" x2="${W - R}" y2="${Y(0)}" class="tl-base"/>
        ${area ? `<path d="${area}" class="tl-area"/>` : ""}${per.length > 1 ? `<path d="${path}" class="tl-line"/>` : ""}${dots}`;

  const periods = pts.slice(1).map((p) =>
    `<span><b>+${fmt(p.add)}</b> ${periodLabel(p.from, p.n)}${p.running ? " (running)" : ""}${d.prod ? ` · ${Math.round((p.add / d.prod) * 100)}%` : ""}</span>`).join("");

  return `<div class="win">
      <div class="win-h">Sale trend since Inward
        <span class="tl-tot">Total sale <b>${fmt(d.sale)}</b><em>Day ${d.days} today</em></span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sale per 30-day period since inward date">${svgBody}</svg>
      <div class="tl-periods">${periods || "<span>No sale periods yet</span>"}</div>
      ${gapQty ? `<div class="tl-gap">${gapQty > 0
        ? `<b>${fmt(gapQty)}</b> pcs of total sale are outside the day periods (sold before Inward Date or not in Retail Sales)`
        : `Day periods show <b>${fmt(-gapQty)}</b> pcs more than total Sale Qty`}</div>` : ""}
    </div>`;
}

function card(d) {
  const achTxt = d.ach === null ? "—" : d.ach.toFixed(1) + "%";
  const img = d.img && d.img.srcs.length
    ? `<img data-v="${d.variant}" alt="${d.variant}" referrerpolicy="no-referrer" class="pending">`
    : `<div class="noimg">No image</div>`;
  const c = COLOR_MAP[d.suffix];
  const colour = c ? c[0] : d.suffix;

  return `
  <article class="card">
    <div class="card-head">
      <span class="lbl">Design Code</span>
      <div class="code-pill">${d.variant}</div>
      ${ratingTag(d.rating)}
    </div>
    <div class="sub-head">
      ${d.product ? `<span class="pname">${esc(d.product)}</span>` : ""}
      ${colour ? `<span class="variant"><span class="sw" style="background:${c ? c[1] : "#ccc"}"></span>${colour}</span>` : ""}
      ${d.nCol > 1 ? `<span class="ncol">Colour ${d.iCol} of ${d.nCol}</span>` : ""}
    </div>
    <div class="card-body">
      <div class="left">
        <div class="img-box" data-v="${d.variant}">${img}</div>
        ${d.mrp || d.designer ? `<div class="img-info">
          ${d.mrp ? `<div><span>MRP</span><b>${fmtMRP(d.mrp)}</b></div>` : ""}
          ${d.designer ? `<div><span>Designer</span><b>${esc(d.designer)}</b></div>` : ""}
        </div>` : ""}
      </div>
      <div class="right">
        <div class="metrics">
          <div class="m"><span>Order Qty</span><b>${fmt(d.order)}</b></div>
          <div class="m"><span>Production Qty</span><b>${fmt(d.prod)}</b><small>${d.order ? d.prodPct.toFixed(0) + "%" : ""}</small></div>
          <div class="m"><span>Sale Qty</span><b>${fmt(d.sale)}</b></div>
          <div class="m"><span>Inward Date</span><b style="font-size:15px">${showDate(d.date)}</b></div>
          <div class="m ach">
            <div class="ach-row"><span>Sale Ach %</span><b style="color:${achColor(d.ach)}">${achTxt}</b></div>
            <div class="bar"><i style="width:${Math.min(d.ach || 0, 100)}%;background:${achColor(d.ach)}"></i></div>
          </div>
        </div>
        ${ratingRow(d)}
        ${windowChart(d)}
      </div>
    </div>
    <div class="remarks">
      <h4>Remarks</h4>
      ${d.remark ? fmtRemark(d.remark) : ""}
    </div>
  </article>`;
}

// "POSITIVE: … NEGATIVE: …" → one line each with a coloured label; other text shown as typed
function fmtRemark(r) {
  const parts = [];
  const re = /(positive|negative)\s*[:\-–]\s*/gi;
  let m, last = 0, label = null;
  while ((m = re.exec(r))) {
    const before = r.slice(last, m.index).trim();
    if (before) parts.push({ label, text: before });
    label = m[1].toLowerCase();
    last = re.lastIndex;
  }
  const rest = r.slice(last).trim();
  if (rest) parts.push({ label, text: rest });
  return parts.map((p) => p.label
    ? `<p class="rm ${p.label}"><span>${p.label === "positive" ? "👍 Positive" : "👎 Negative"}</span>${esc(p.text)}</p>`
    : `<p>${esc(p.text)}</p>`).join("");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// One full-width row per multi-colour design: colours side by side + sale split
function pairRow(g) {
  const split = g.items.map((d) => {
    const c = COLOR_MAP[d.suffix];
    const share = g.sale ? Math.round((d.sale / g.sale) * 100) : 0;
    return { name: c ? c[0] : d.suffix || d.variant, col: c ? c[1] : "#bbb", sale: d.sale, share };
  });
  const best = Math.max(...split.map((x) => x.sale));
  return `
  <section class="pair">
    <div class="pair-head">
      <div><span class="lbl">Colour comparison</span> <b>${g.sku}</b>
        ${g.items[0].product ? `<span class="pair-prod">${esc(g.items[0].product)}</span>` : ""}</div>
      <div class="pair-tot">${ratingTag(g.rating)} Total sale <b>${fmt(g.sale)}</b> · Ach ${g.ach === null ? "—" : g.ach.toFixed(1) + "%"}</div>
    </div>
    <div class="split">${split.map((x) =>
      `<i style="width:${g.sale ? Math.max(x.share, 0) : 100 / split.length}%;background:${x.col}" title="${x.name} ${x.sale}"></i>`).join("")}</div>
    <div class="split-key">${split.map((x) =>
      `<span><span class="sw" style="background:${x.col}"></span>${x.name} <b>${fmt(x.sale)}</b> (${x.share}%)${g.sale && x.sale === best && split.length > 1 ? " ★" : ""}</span>`).join("")}</div>
    <div class="pair-grid">${g.items.map(card).join("")}</div>
  </section>`;
}

function render() {
  const q = $("search").value.trim().toUpperCase();
  const cat = $("catFilter").value;
  const st = $("statusFilter").value;
  const sort = $("sortBy").value;

  let list = DESIGNS.filter((d) => {
    if (cat && d.cat !== cat) return false;
    if (q && !d.variant.includes(q) && !(d.product || "").toUpperCase().includes(q)) return false;
    if (st === "partial") return d.prod > 0 && d.prodPct < 95;
    if (st === "notInward") return !d.date;
    if (st === "inward") return !!d.date;
    if (["fast", "steady", "slow", "early"].includes(st)) return d.rating.key === st;
    if (st && d.status !== st) return false;
    return true;
  });

  // Group colour variants of the same design so they sit side by side
  const bySku = new Map();
  list.forEach((d) => { if (!bySku.has(d.sku)) bySku.set(d.sku, []); bySku.get(d.sku).push(d); });
  const groups = [...bySku.values()].map((items) => {
    items.sort((a, b) => a.variant.localeCompare(b.variant));
    const order = items.reduce((a, d) => a + d.order, 0);
    const prod = items.reduce((a, d) => a + d.prod, 0);
    const sale = items.reduce((a, d) => a + d.sale, 0);
    return { sku: items[0].sku, items, order, prod, sale, ach: prod ? (sale / prod) * 100 : null, rating: groupRating(items),
      // Display tiers: 1) inwarded + image  2) inwarded, no image  3) not inwarded + image  4) not inwarded, no image
      tier: (items.some((d) => d.date) ? 0 : 2) + (items.some((d) => d.img) ? 0 : 1) };
  });
  const achV = (g) => (g.ach === null ? -1 : g.ach);
  const scoreV = (g) => (g.rating.score === null ? -1 : g.rating.score);
  const sorters = {
    code: (a, b) => a.sku.localeCompare(b.sku),
    rateDesc: (a, b) => scoreV(b) - scoreV(a),
    rateAsc: (a, b) => scoreV(a) - scoreV(b),
    achDesc: (a, b) => achV(b) - achV(a),
    achAsc: (a, b) => achV(a) - achV(b),
    saleDesc: (a, b) => b.sale - a.sale,
    orderDesc: (a, b) => b.order - a.order,
  };
  groups.sort((a, b) => a.tier - b.tier || sorters[sort](a, b));
  list = groups.flatMap((g) => g.items);

  // KPIs follow the filter
  const t = list.reduce((a, d) => ({ o: a.o + d.order, i: a.i + d.prod, s: a.s + d.sale }), { o: 0, i: 0, s: 0 });
  $("kDesigns").textContent = fmt(new Set(list.map((d) => d.sku)).size);
  $("kVariants").textContent = `${fmt(list.length)} colour variants`;
  const styles = new Map();
  list.forEach((d) => styles.set(d.sku, (styles.get(d.sku) || false) || !!d.date));
  const yetStyles = [...styles.values()].filter((v) => !v).length;
  const yetColours = list.filter((d) => !d.date).length;
  $("kYet").innerHTML = `Yet to Inward: <b>${fmt(yetStyles)}</b> styles <span>(${fmt(yetColours)} colours)</span>`;
  $("kOrder").textContent = fmt(t.o);
  $("kInward").textContent = fmt(t.i);
  $("kInwardPct").textContent = t.o ? `${((t.i / t.o) * 100).toFixed(1)}% of order` : "";
  $("kSale").textContent = fmt(t.s);
  $("kAch").textContent = t.i ? ((t.s / t.i) * 100).toFixed(1) + "%" : "—";
  $("count").textContent = `${list.length} of ${DESIGNS.length} variants`;
  const rc = { fast: 0, steady: 0, slow: 0, early: 0 };
  groups.forEach((g) => rc[g.rating.key]++);
  $("ratingBar").innerHTML = `<span class="rb-h">Style rating</span>` + Object.keys(rc).map((k) =>
    `<button type="button" class="rb r-${k}${st === k ? " on" : ""}" data-r="${k}">${RATING_LABEL[k]} <b>${fmt(rc[k])}</b></button>`).join("") +
    `<span class="rb-note">styles · colour cards filter by their own rating</span>`;

  $("grid").innerHTML = list.length
    ? groups.map((g) => g.items.length > 1 ? pairRow(g) : card(g.items[0])).join("")
    : `<div class="state">No designs match the filters.</div>`;
  imgActive = 0;
  queueImages();
}


/* ---------- Image loader ----------
 * Loads Drive images a few at a time (Drive blocks pages that request 100+ images at once),
 * tries each address type in turn, retries once, and offers tap-to-retry. */
const imgQueue = [];
let imgActive = 0;
const IMG_PARALLEL = 4;

function pumpImages() {
  while (imgActive < IMG_PARALLEL && imgQueue.length) {
    const el = imgQueue.shift();
    if (!el.isConnected) continue;
    imgActive++;
    loadOne(el, 0, 0);
  }
}
function loadOne(el, i, attempt) {
  const d = DESIGNS.find((x) => x.variant === el.dataset.v);
  const srcs = d && d.img ? d.img.srcs : [];
  if (i >= srcs.length) {
    if (attempt === 0) { setTimeout(() => loadOne(el, 0, 1), 4000); return; }   // one retry after a pause
    imgActive--; pumpImages();
    const box = el.closest(".img-box");
    if (box) box.innerHTML = `<div class="noimg retry" data-v="${el.dataset.v}">Image not loaded<br><u>Tap to retry</u></div>`;
    return;
  }
  el.onload = () => { el.classList.remove("pending"); imgActive--; pumpImages(); };
  el.onerror = () => loadOne(el, i + 1, attempt);
  el.src = srcs[i] + (attempt ? (srcs[i].includes("?") ? "&" : "?") + "r=" + Date.now() : "");
}
const imgObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { imgObserver.unobserve(e.target); imgQueue.push(e.target); pumpImages(); }
    }), { rootMargin: "400px" })
  : null;
function queueImages() {
  imgQueue.length = 0;
  document.querySelectorAll("#grid img.pending").forEach((el) => {
    if (imgObserver) imgObserver.observe(el); else imgQueue.push(el);
  });
  pumpImages();
}


/* ---------- Summary: Diwali 2025 vs 2026 by category ---------- */
// Fallback if the Summary tab can't be read (2025 Diwali figures)
const SUMMARY_2025_DEFAULT = [
  ["KURTA", 36, 35308, 16880], ["SKIRT SET", 16, 6894, 2737], ["KIDS SKIRT SET", 7, 3670, 1852],
  ["KIDS ANARKALI", 8, 3660, 2050], ["ANARKALI", 28, 12917, 6051], ["SKD", 20, 11240, 4364],
  ["TUNICS", 5, 1206, 424], ["SKIRT", 5, 1256, 397],
].map(([cat, styles, order, sold]) => ({ cat, styles, order, sold }));
let SUMMARY_2025 = SUMMARY_2025_DEFAULT;

function readSummary(rows) {
  const out = rows.map((o) => ({
    cat: String(pick(o, "category") || "").trim().toUpperCase(),
    styles: num(pick(o, "styles", "style")),
    order: num(pick(o, "order", "order qty")),
    sold: num(pick(o, "sold qty", "sold", "sale qty", "sales qty")),
  })).filter((r) => r.cat && r.cat !== "TOTAL" && (r.order || r.sold || r.styles));
  return out.length ? out : SUMMARY_2025_DEFAULT;
}

function renderSummary() {
  const cats = SUMMARY_2025.map((r) => r.cat);
  const alias = (c) => (CONFIG.SUMMARY_ALIASES[c] || c).toUpperCase();
  const now = {}; cats.forEach((c) => (now[c] = { skus: new Set(), order: 0, sold: 0 }));
  const ignored = {};
  DESIGNS.forEach((d) => {
    const c = alias(d.cat);
    if (!now[c]) { (ignored[d.cat] = ignored[d.cat] || new Set()).add(d.sku); return; }
    now[c].skus.add(d.sku); now[c].order += d.order; now[c].sold += d.sale;
  });

  const pct = (s, o) => (o ? (s / o) * 100 : null);
  const pTxt = (v) => (v === null ? "—" : v.toFixed(0) + "%");
  const diff = (a, b, isPct) => {
    if (a === null || b === null) return "";
    const d = b - a;
    if (!d) return `<i class="eq">=</i>`;
    return `<i class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${isPct ? Math.abs(d).toFixed(0) + " pts" : fmt(Math.abs(d))}</i>`;
  };
  const row = (label, a, b, cls = "") => {
    const pa = pct(a.sold, a.order), pb = pct(b.sold, b.order);
    const w = (v) => Math.min(v || 0, 100);
    return `<tr class="${cls}">
      <th>${label}</th>
      <td>${fmt(a.styles)}</td><td class="y26">${fmt(b.styles)} ${diff(a.styles, b.styles)}</td>
      <td>${fmt(a.order)}</td><td class="y26">${fmt(b.order)}</td>
      <td>${fmt(a.sold)}</td><td class="y26">${fmt(b.sold)}</td>
      <td>${pTxt(pa)}</td><td class="y26"><b>${pTxt(pb)}</b> ${diff(pa, pb, true)}</td>
      <td class="sbar"><div><span class="b25" style="width:${w(pa)}%"></span></div><div><span class="b26" style="width:${w(pb)}%"></span></div></td>
    </tr>`;
  };

  const tot = (list) => list.reduce((t, r) => ({ styles: t.styles + r.styles, order: t.order + r.order, sold: t.sold + r.sold }), { styles: 0, order: 0, sold: 0 });
  const r26 = cats.map((c) => ({ styles: now[c].skus.size, order: now[c].order, sold: now[c].sold }));
  const t25 = tot(SUMMARY_2025), t26 = tot(r26);
  const ign = Object.keys(ignored);

  $("summary").innerHTML = `
    <div class="sum-head">
      <h2>Diwali Summary · 2025 vs 2026</h2>
      <p>Category-wise · Styles = unique Design Codes (SKU) · Sales % = Sold Qty ÷ Order Qty · 2026 is season-to-date</p>
    </div>
    <div class="sum-cards">
      <div class="kpi"><span>Styles</span><b>${fmt(t26.styles)}</b><small>2025: ${fmt(t25.styles)}</small></div>
      <div class="kpi"><span>Order Qty</span><b>${fmt(t26.order)}</b><small>2025: ${fmt(t25.order)}</small></div>
      <div class="kpi"><span>Sold Qty</span><b>${fmt(t26.sold)}</b><small>2025: ${fmt(t25.sold)}</small></div>
      <div class="kpi gold"><span>Sales %</span><b>${pTxt(pct(t26.sold, t26.order))}</b><small>2025: ${pTxt(pct(t25.sold, t25.order))}</small></div>
    </div>
    <div class="sum-wrap">
      <table class="sum">
        <thead>
          <tr><th rowspan="2">Category</th><th colspan="2">Styles</th><th colspan="2">Order Qty</th><th colspan="2">Sold Qty</th><th colspan="2">Sales %</th><th rowspan="2" class="sbar-h"><span class="k25"></span>2025 <span class="k26"></span>2026</th></tr>
          <tr><th>2025</th><th class="y26">2026</th><th>2025</th><th class="y26">2026</th><th>2025</th><th class="y26">2026</th><th>2025</th><th class="y26">2026</th></tr>
        </thead>
        <tbody>${cats.map((c, i) => row(c, SUMMARY_2025[i], r26[i])).join("")}</tbody>
        <tfoot>${row("TOTAL", t25, t26, "total")}</tfoot>
      </table>
    </div>
    ${ign.length ? `<p class="sum-note">Not in the 2025 categories, so left out: ${ign.map((c) => `${esc(c)} (${ignored[c].size})`).join(", ")}.
      If any of these is really one of the 2025 categories under another name, add it to <code>SUMMARY_ALIASES</code> in app.js.</p>` : ""}`;
}

function setView(v) {
  const sum = v === "summary";
  document.body.classList.toggle("view-summary", sum);
  $("summaryBtn").textContent = sum ? "◧ Styles" : "▤ Summary";
  $("summary").hidden = !sum;
  if (sum) renderSummary();
  try { localStorage.setItem("diwaliView", v); } catch (e) {}
}

/* ---------- Load ---------- */
async function getCSV(url, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.TIMEOUT_SEC * 1000);
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`${label} sheet returned HTTP ${r.status}`);
    const text = await r.text();
    return { rows: toObjects(parseCSV(text)), loadingCells: (text.match(/Loading\.\.\./g) || []).length };
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${label} sheet did not answer within ${CONFIG.TIMEOUT_SEC} seconds – the sheet is still calculating`);
    throw e;
  } finally { clearTimeout(timer); }
}

async function load() {
  const t0 = Date.now();
  const tick = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    $("updated").textContent = `Loading… ${sec}s`;
    const st = document.querySelector("#grid .state");
    if (st && !DESIGNS.length) st.textContent = `Loading data from Google Sheet… ${sec}s`;
  }, 1000);
  try {
    const [img, data, sum] = await Promise.all([
      getCSV(CONFIG.IMG_CSV, "IMG"), getCSV(CONFIG.DATA_CSV, "Data"),
      getCSV(CONFIG.SUMMARY_CSV, "Summary").catch(() => null),
    ]);
    SUMMARY_2025 = sum ? readSummary(sum.rows) : SUMMARY_2025_DEFAULT;
    build(img.rows, data.rows);
    render();
    if (!$("summary").hidden) renderSummary();
    $("updated").textContent = "Updated " + new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    if (data.loadingCells) {
      $("foot").textContent = `⚠ ${data.loadingCells} cells in the Data sheet were still "Loading..." – those show as 0. Press Refresh in a minute. · ` + $("foot").textContent;
    }
  } catch (e) {
    console.error(e);
    $("grid").innerHTML = `<div class="state err">Couldn't load the Google Sheet: ${esc(e.message)}.<br><br>
      Open the Data CSV link in a new tab to check it loads, then press Refresh.</div>`;
    $("updated").textContent = "Load failed";
  } finally { clearInterval(tick); }
}

/* ---------- Events ---------- */
["search", "catFilter", "statusFilter", "sortBy"].forEach((id) =>
  $(id).addEventListener("input", render));
$("refreshBtn").addEventListener("click", load);
$("summaryBtn").addEventListener("click", () => setView($("summary").hidden ? "summary" : "styles"));
try { if (localStorage.getItem("diwaliView") === "summary") setView("summary"); } catch (e) {}
$("ratingBar").addEventListener("click", (e) => {
  const b = e.target.closest(".rb");
  if (!b) return;
  $("statusFilter").value = $("statusFilter").value === b.dataset.r ? "" : b.dataset.r;
  render();
});
$("kYet").addEventListener("click", () => {
  $("statusFilter").value = $("statusFilter").value === "notInward" ? "" : "notInward";
  render();
});

$("grid").addEventListener("click", (e) => {
  const retry = e.target.closest(".noimg.retry");
  if (retry) {
    const box = retry.closest(".img-box");
    box.innerHTML = `<img data-v="${retry.dataset.v}" alt="${retry.dataset.v}" referrerpolicy="no-referrer" class="pending">`;
    imgQueue.unshift(box.firstElementChild); pumpImages();
    return;
  }
  const box = e.target.closest(".img-box");
  if (!box) return;
  const d = DESIGNS.find((x) => x.variant === box.dataset.v);
  if (!d || !d.img) return;
  $("lbImg").referrerPolicy = "no-referrer";
  $("lbImg").src = d.img.big;
  $("lbCap").textContent = d.variant;
  $("lightbox").hidden = false;
});
$("lightbox").addEventListener("click", (e) => {
  if (e.target.id !== "lbImg") $("lightbox").hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("lightbox").hidden = true; });

load();
