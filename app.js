/* Diwali'26 Product Performance dashboard
 * Reads two published Google Sheet CSVs and joins them on SKU (Design Code).
 *   IMG sheet  : SKU | File Name | File ID | Direct Image URL
 *   DATA sheet : SKU | Variant | Product Name | Order Qty | Inward Qty (shown as Production Qty) | Sale Qty
 *                | Inward Date | Remarks | 30 Days | 60 Days | 90 Days | 120 Days (optional sale-window columns)
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
  WINDOWS: [30, 60, 90, 120],
  TIMEOUT_SEC: 90,  // give up waiting for Google after this many seconds
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
  const h = rows.findIndex((r) => r.some((c) => c.trim().toUpperCase() === "SKU"));
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
  for (const k of Object.keys(o)) {
    const c = k.replace(/[\s_]/g, "");
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
    const key = (pick(o, "design code", "sku", "file name", "filename") || "")
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
      cat: sku.replace(/\d.*$/, ""),
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

  const cats = [...new Set(DESIGNS.map((d) => d.cat))].sort();
  $("catFilter").innerHTML = `<option value="">All Categories</option>` +
    cats.map((c) => `<option>${c}</option>`).join("");
}

/* ---------- Render ---------- */
function achColor(a) {
  if (a === null) return "var(--grey)";
  return a >= CONFIG.GOOD ? "var(--green)" : a >= CONFIG.AVG ? "var(--amber)" : "var(--red)";
}

// Small bar chart: sale in first 30 / 60 / 90 / 120 days after Inward Date
function windowChart(d) {
  if (!HAS_WINDOWS) {
    return `<div class="win"><div class="win-h">Sale trend since Inward</div>
      <p class="win-note">Add <b>30 Days · 60 Days · 90 Days · 120 Days</b> columns to the Data sheet to see this chart.</p></div>`;
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
      <text x="${X(i)}" y="${H - B + 14}" class="tl-x">${from}–${n} days</text>`;
  }).join("");
  const path = per.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.add).toFixed(1)}`).join(" ");
  const area = per.length > 1 ? `${path} L${X(per.length - 1).toFixed(1)},${Y(0)} L${X(0).toFixed(1)},${Y(0)} Z` : "";
  const dots = per.map((p, i) => `
      <circle cx="${X(i)}" cy="${Y(p.add)}" r="4.5" class="${p.running ? "tl-dot run" : "tl-dot"}"/>
      <text x="${X(i)}" y="${Y(p.add) - 9}" class="tl-v">${fmt(p.add)}</text>`).join("");
  const svgBody = `${slots}<line x1="${L}" y1="${Y(0)}" x2="${W - R}" y2="${Y(0)}" class="tl-base"/>
        ${area ? `<path d="${area}" class="tl-area"/>` : ""}${per.length > 1 ? `<path d="${path}" class="tl-line"/>` : ""}${dots}`;

  const periods = pts.slice(1).map((p) =>
    `<span><b>+${fmt(p.add)}</b> ${p.from}–${p.n} d${p.running ? " (running)" : ""}${d.prod ? ` · ${Math.round((p.add / d.prod) * 100)}%` : ""}</span>`).join("");

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
  const tagTxt = { good: "Fast", avg: "Average", low: "Slow", pending: "No Production" }[d.status];
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
      <span class="tag ${d.status}">${tagTxt}</span>
    </div>
    <div class="sub-head">
      ${d.product ? `<span class="pname">${esc(d.product)}</span>` : ""}
      ${colour ? `<span class="variant"><span class="sw" style="background:${c ? c[1] : "#ccc"}"></span>${colour}</span>` : ""}
      ${d.nCol > 1 ? `<span class="ncol">Colour ${d.iCol} of ${d.nCol}</span>` : ""}
    </div>
    <div class="card-body">
      <div class="img-box" data-v="${d.variant}">${img}</div>
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
        ${windowChart(d)}
      </div>
    </div>
    <div class="remarks">
      <h4>Remarks</h4>
      ${d.remark ? `<p>${esc(d.remark)}</p>` : ""}
    </div>
  </article>`;
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
      <div class="pair-tot">Total sale <b>${fmt(g.sale)}</b> · Ach ${g.ach === null ? "—" : g.ach.toFixed(1) + "%"}</div>
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
    return { sku: items[0].sku, items, order, prod, sale, ach: prod ? (sale / prod) * 100 : null,
      // Display tiers: 1) image + production  2) production, no image  3) image, no production  4) neither
      tier: (prod > 0 ? 0 : 2) + (items.some((d) => d.img) ? 0 : 1) };
  });
  const achV = (g) => (g.ach === null ? -1 : g.ach);
  const sorters = {
    code: (a, b) => a.sku.localeCompare(b.sku),
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
  $("kOrder").textContent = fmt(t.o);
  $("kInward").textContent = fmt(t.i);
  $("kInwardPct").textContent = t.o ? `${((t.i / t.o) * 100).toFixed(1)}% of order` : "";
  $("kSale").textContent = fmt(t.s);
  $("kAch").textContent = t.i ? ((t.s / t.i) * 100).toFixed(1) + "%" : "—";
  $("count").textContent = `${list.length} of ${DESIGNS.length} variants`;

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
    const [img, data] = await Promise.all([getCSV(CONFIG.IMG_CSV, "IMG"), getCSV(CONFIG.DATA_CSV, "Data")]);
    build(img.rows, data.rows);
    render();
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
