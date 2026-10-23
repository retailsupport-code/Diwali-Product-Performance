/* Diwali'26 Product Performance dashboard
 * Reads two published Google Sheet CSVs and joins them on SKU (Design Code).
 *   IMG sheet  : SKU | File Name | File ID | Direct Image URL
 *   DATA sheet : SKU | Variant | Order Qty | Inward Qty | Sale Qty | Inward Date | Remarks
 */
const CONFIG = {
  IMG_CSV:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPpb5TKk-gVY8zKWu58hoKrPQ1bBVYvLs1fy6RclLbFvcei6WN4AjIqiH1OrEnry0oz3Ya9QiLyZ-L/pub?gid=0&single=true&output=csv",
  DATA_CSV:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRPpb5TKk-gVY8zKWu58hoKrPQ1bBVYvLs1fy6RclLbFvcei6WN4AjIqiH1OrEnry0oz3Ya9QiLyZ-L/pub?gid=1180891349&single=true&output=csv",
  // Achievement colour bands (Sale ÷ Inward)
  GOOD: 30,
  AVG: 10,
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

/* ---------- Build ---------- */
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

  const map = new Map();
  dataRows.forEach((o) => {
    const sku = pick(o, "sku", "design code").toUpperCase();
    if (!sku) return;
    if (!map.has(sku)) map.set(sku, { sku, variants: [], remarks: [] });
    const d = map.get(sku);
    const variant = pick(o, "variant") || sku;
    const suffix = variant.toUpperCase().startsWith(sku) ? variant.slice(sku.length).toUpperCase() : "";
    const product = pick(o, "product name", "product", "item name", "style name");
    if (product && !d.product) d.product = product;
    d.variants.push({
      variant, suffix, product,
      order: num(pick(o, "order qty", "order")),
      inward: num(pick(o, "inward qty", "inward")),
      sale: num(pick(o, "sale qty", "sale", "sales qty")),
      date: fmtDate(pick(o, "inward date")),
    });
    const r = pick(o, "remarks", "remark");
    if (r) d.remarks.push({ product, text: r });
  });

  DESIGNS = [...map.values()].map((d) => {
    const t = d.variants.reduce((a, v) => ({
      order: a.order + v.order, inward: a.inward + v.inward, sale: a.sale + v.sale,
    }), { order: 0, inward: 0, sale: 0 });
    const ach = t.inward ? (t.sale / t.inward) * 100 : null;
    const inwPct = t.order ? (t.inward / t.order) * 100 : 0;
    const status = ach === null ? "pending" : ach >= CONFIG.GOOD ? "good" : ach >= CONFIG.AVG ? "avg" : "low";
    const dates = [...new Set(d.variants.map((v) => v.date).filter(Boolean))];
    return {
      ...d, ...t, ach, inwPct, status, dates,
      cat: d.sku.replace(/\d.*$/, ""),
      img: imgMap[d.sku] || null,
    };
  });

  const noImg = DESIGNS.filter((d) => !d.img).length;
  const imgOnly = Object.keys(imgMap).filter((k) => !map.has(k)).length;
  $("foot").textContent =
    `${DESIGNS.length} designs · ${noImg} without image in IMG sheet` +
    (imgOnly ? ` · ${imgOnly} images with no data row` : "") +
    ` · Sale Ach % = Sale Qty ÷ Inward Qty`;

  const cats = [...new Set(DESIGNS.map((d) => d.cat))].sort();
  $("catFilter").innerHTML = `<option value="">All Categories</option>` +
    cats.map((c) => `<option>${c}</option>`).join("");
}

/* ---------- Render ---------- */
function achColor(a) {
  if (a === null) return "var(--grey)";
  return a >= CONFIG.GOOD ? "var(--green)" : a >= CONFIG.AVG ? "var(--amber)" : "var(--red)";
}

function card(d) {
  const tagTxt = { good: "Fast", avg: "Average", low: "Slow", pending: "Not Inwarded" }[d.status];
  const achTxt = d.ach === null ? "—" : d.ach.toFixed(1) + "%";
  const img = d.img
    ? `<img src="${d.img.thumb}" alt="${d.sku}" loading="lazy"
         onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${d.img.alt}'}else{this.replaceWith(Object.assign(document.createElement('div'),{className:'noimg',textContent:'Image unavailable'}))}">`
    : `<div class="noimg">No image</div>`;

  const showVariants = d.variants.length > 1 || d.variants[0].suffix;
  const vt = showVariants ? `
    <table class="variants">
      <tr><th>Colour</th><th>Order</th><th>Inward</th><th>Sale</th><th>Ach%</th></tr>
      ${d.variants.map((v) => {
        const c = COLOR_MAP[v.suffix];
        const a = v.inward ? ((v.sale / v.inward) * 100).toFixed(0) + "%" : "—";
        return `<tr>
          <td><span class="sw" style="background:${c ? c[1] : "#ccc"}"></span>${c ? c[0] : v.suffix || v.variant}</td>
          <td>${fmt(v.order)}</td><td>${fmt(v.inward)}</td><td>${fmt(v.sale)}</td>
          <td style="color:${achColor(v.inward ? (v.sale / v.inward) * 100 : null)}">${a}</td></tr>`;
      }).join("")}
    </table>` : "";

  // Remarks = customer review typed in the Data sheet's Remarks column only (blank until filled)
  // Remarks = customer review from the Data sheet's Remarks column (blank until filled).
  // If one design has different product names across rows, each remark is labelled with its product name.
  const names = new Set(d.variants.map((v) => v.product).filter(Boolean));
  const sheetRem = d.remarks.length
    ? `<p>${d.remarks.map((r) =>
        names.size > 1 && r.product ? `<b>${esc(r.product)}:</b> ${esc(r.text)}` : esc(r.text)
      ).join("<br>")}</p>`
    : "";

  return `
  <article class="card">
    <div class="card-head">
      <span class="lbl">Design Code</span>
      <div class="code-pill">${d.sku}</div>
      <span class="tag ${d.status}">${tagTxt}</span>
    </div>
    ${d.product ? `<div class="pname">${esc(d.product)}</div>` : ""}
    <div class="card-body">
      <div class="img-box" data-sku="${d.sku}">${img}</div>
      <div class="right">
        <div class="metrics">
          <div class="m"><span>Order Qty</span><b>${fmt(d.order)}</b></div>
          <div class="m"><span>Inward Qty</span><b>${fmt(d.inward)}</b><small>${d.order ? d.inwPct.toFixed(0) + "%" : ""}</small></div>
          <div class="m"><span>Sale Qty</span><b>${fmt(d.sale)}</b></div>
          <div class="m"><span>Inward Date</span><b style="font-size:15px">${d.dates.join(", ") || "—"}</b></div>
          <div class="m ach">
            <div class="ach-row"><span>Sale Ach %</span><b style="color:${achColor(d.ach)}">${achTxt}</b></div>
            <div class="bar"><i style="width:${Math.min(d.ach || 0, 100)}%;background:${achColor(d.ach)}"></i></div>
          </div>
        </div>
        ${vt}
      </div>
    </div>
    <div class="remarks">
      <h4>Remarks</h4>
      ${sheetRem}
    </div>
  </article>`;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render() {
  const q = $("search").value.trim().toUpperCase();
  const cat = $("catFilter").value;
  const st = $("statusFilter").value;
  const sort = $("sortBy").value;

  let list = DESIGNS.filter((d) => {
    if (cat && d.cat !== cat) return false;
    if (q && !d.sku.includes(q) && !(d.product || "").toUpperCase().includes(q) && !d.variants.some((v) => v.variant.toUpperCase().includes(q))) return false;
    if (st === "partial") return d.inward > 0 && d.inwPct < 95;
    if (st && d.status !== st) return false;
    return true;
  });

  const achV = (d) => (d.ach === null ? -1 : d.ach);
  const sorters = {
    code: (a, b) => a.sku.localeCompare(b.sku),
    achDesc: (a, b) => achV(b) - achV(a),
    achAsc: (a, b) => achV(a) - achV(b),
    saleDesc: (a, b) => b.sale - a.sale,
    orderDesc: (a, b) => b.order - a.order,
  };
  list.sort(sorters[sort]);

  // KPIs follow the filter
  const t = list.reduce((a, d) => ({ o: a.o + d.order, i: a.i + d.inward, s: a.s + d.sale }), { o: 0, i: 0, s: 0 });
  $("kDesigns").textContent = fmt(list.length);
  $("kOrder").textContent = fmt(t.o);
  $("kInward").textContent = fmt(t.i);
  $("kInwardPct").textContent = t.o ? `${((t.i / t.o) * 100).toFixed(1)}% of order` : "";
  $("kSale").textContent = fmt(t.s);
  $("kAch").textContent = t.i ? ((t.s / t.i) * 100).toFixed(1) + "%" : "—";
  $("count").textContent = `${list.length} of ${DESIGNS.length} designs`;

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
