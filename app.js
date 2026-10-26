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

/* ---------- Build ---------- */
let HAS_WINDOWS = false;
function build(imgRows, dataRows) {
  const imgMap = {};
  imgRows.forEach((o) => {
    const sku = pick(o, "sku", "design code").toUpperCase();
    if (!sku) return;
    const id = driveId(o);
    imgMap[sku] = {
      thumb: id ? `https://drive.google.com/thumbnail?id=${id}&sz=w600` : "",
      big: id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : "",
      alt: id ? `https://lh3.googleusercontent.com/d/${id}=w600` : pick(o, "direct image url"),
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
      img: imgMap[sku] || null,
    });
  });

  // how many colours each design has (for the "1 of 2 colours" label)
  const per = {};
  DESIGNS.forEach((d) => (per[d.sku] = (per[d.sku] || 0) + 1));
  const seen = {};
  DESIGNS.forEach((d) => { d.nCol = per[d.sku]; d.iCol = (seen[d.sku] = (seen[d.sku] || 0) + 1); });

  const skus = new Set(DESIGNS.map((d) => d.sku));
  const noImg = [...skus].filter((s) => !imgMap[s]).length;
  const imgOnly = Object.keys(imgMap).filter((k) => !skus.has(k)).length;
  $("foot").textContent =
    `${skus.size} designs · ${DESIGNS.length} colour variants · ${noImg} designs without image` +
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

  const W = 300, H = 130, L = 26, R = 10, T = 16, B = 26;
  const maxY = Math.max(1, d.sale, inWin) * 1.12;
  const X = (day) => L + (day / 120) * (W - L - R);
  const Y = (v) => T + (1 - v / maxY) * (H - T - B);

  const grid = [0, 30, 60, 90, 120].map((t) => `
      <line x1="${X(t)}" y1="${T}" x2="${X(t)}" y2="${H - B}" class="tl-grid"/>
      <text x="${X(t)}" y="${H - B + 13}" class="tl-x" style="text-anchor:${t === 0 ? "start" : t === 120 ? "end" : "middle"}">${t === 0 ? "Inward" : "Day " + t}</text>`).join("");
  const future = prev < 120
    ? `<rect x="${X(pts[pts.length - 1].day)}" y="${T}" width="${X(120) - X(pts[pts.length - 1].day)}" height="${H - T - B}" class="tl-future"/>
       <text x="${(X(pts[pts.length - 1].day) + X(120)) / 2}" y="${T + (H - T - B) / 2 + 4}" class="tl-soon">upcoming</text>` : "";
  const total = d.sale
    ? `<line x1="${L}" y1="${Y(d.sale)}" x2="${W - R}" y2="${Y(d.sale)}" class="tl-total"/>
       <text x="${W - R}" y="${Y(d.sale) - 4}" class="tl-total-t">Total sale ${fmt(d.sale)}</text>` : "";
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.day).toFixed(1)},${Y(p.cum).toFixed(1)}`).join(" ");
  const area = `${path} L${X(pts[pts.length - 1].day).toFixed(1)},${Y(0)} L${X(0)},${Y(0)} Z`;
  const dots = pts.slice(1).map((p) => `
      <circle cx="${X(p.day)}" cy="${Y(p.cum)}" r="4" class="${p.running ? "tl-dot run" : "tl-dot"}"/>
      <text x="${X(p.day)}" y="${Y(p.cum) - 8}" class="tl-v">${fmt(p.cum)}</text>`).join("");

  const periods = pts.slice(1).map((p) =>
    `<span><b>+${fmt(p.add)}</b> ${p.from}–${p.n} d${p.running ? " (running)" : ""}${d.prod ? ` · ${Math.round((p.add / d.prod) * 100)}%` : ""}</span>`).join("");

  return `<div class="win">
      <div class="win-h">Sale trend since Inward <span>Day ${d.days} today</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative sale since inward date">
        ${grid}${future}${total}
        <path d="${area}" class="tl-area"/><path d="${path}" class="tl-line"/>${dots}
      </svg>
      <div class="tl-periods">${periods || "<span>No sale periods yet</span>"}</div>
      ${gapQty ? `<div class="tl-gap">${gapQty > 0
        ? `<b>${fmt(gapQty)}</b> pcs of total sale are outside the day periods (sold before Inward Date or not in Retail Sales)`
        : `Day periods show <b>${fmt(-gapQty)}</b> pcs more than total Sale Qty`}</div>` : ""}
    </div>`;
}

function card(d) {
  const tagTxt = { good: "Fast", avg: "Average", low: "Slow", pending: "No Production" }[d.status];
  const achTxt = d.ach === null ? "—" : d.ach.toFixed(1) + "%";
  const img = d.img
    ? `<img src="${d.img.thumb}" alt="${d.sku}" loading="lazy"
         onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${d.img.alt}'}else{this.replaceWith(Object.assign(document.createElement('div'),{className:'noimg',textContent:'Image unavailable'}))}">`
    : `<div class="noimg">No image</div>`;
  const c = COLOR_MAP[d.suffix];
  const colour = c ? c[0] : d.suffix;

  return `
  <article class="card">
    <div class="card-head">
      <span class="lbl">Design Code</span>
      <div class="code-pill">${d.sku}</div>
      <span class="tag ${d.status}">${tagTxt}</span>
    </div>
    <div class="sub-head">
      ${d.product ? `<span class="pname">${esc(d.product)}</span>` : ""}
      <span class="variant">${colour ? `<span class="sw" style="background:${c ? c[1] : "#ccc"}"></span>${colour} · ` : ""}${d.variant}</span>
      ${d.nCol > 1 ? `<span class="ncol">Colour ${d.iCol} of ${d.nCol}</span>` : ""}
    </div>
    <div class="card-body">
      <div class="img-box" data-sku="${d.sku}">${img}</div>
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

  const achV = (d) => (d.ach === null ? -1 : d.ach);
  const sorters = {
    code: (a, b) => a.variant.localeCompare(b.variant),
    achDesc: (a, b) => achV(b) - achV(a),
    achAsc: (a, b) => achV(a) - achV(b),
    saleDesc: (a, b) => b.sale - a.sale,
    orderDesc: (a, b) => b.order - a.order,
  };
  list.sort(sorters[sort]);

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
    ? list.map(card).join("")
    : `<div class="state">No designs match the filters.</div>`;
}

/* ---------- Load ---------- */
async function getCSV(url) {
  const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return toObjects(parseCSV(await r.text()));
}

async function load() {
  $("updated").textContent = "Loading…";
  try {
    const [img, data] = await Promise.all([getCSV(CONFIG.IMG_CSV), getCSV(CONFIG.DATA_CSV)]);
    build(img, data);
    render();
    $("updated").textContent = "Updated " + new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    console.error(e);
    $("grid").innerHTML = `<div class="state err">Couldn't load the Google Sheet (${e.message}). Check that the sheet is still "Published to the web" as CSV.</div>`;
    $("updated").textContent = "Load failed";
  }
}

/* ---------- Events ---------- */
["search", "catFilter", "statusFilter", "sortBy"].forEach((id) =>
  $(id).addEventListener("input", render));
$("refreshBtn").addEventListener("click", load);

$("grid").addEventListener("click", (e) => {
  const box = e.target.closest(".img-box");
  if (!box) return;
  const d = DESIGNS.find((x) => x.sku === box.dataset.sku);
  if (!d || !d.img) return;
  $("lbImg").src = d.img.big;
  $("lbCap").textContent = d.sku;
  $("lightbox").hidden = false;
});
$("lightbox").addEventListener("click", (e) => {
  if (e.target.id !== "lbImg") $("lightbox").hidden = true;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("lightbox").hidden = true; });

load();
