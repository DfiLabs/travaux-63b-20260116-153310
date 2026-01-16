/* global TRAVAUX_ITEMS */

const STORAGE_KEY = "travaux63b_comments_v1";
const SHARE_PREFIX = "data=";

function eur(cents) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
}

function eurInput(cents) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((cents || 0) / 100);
}

function clampInt(n, fallback = 0) {
  const x = Number.parseInt(String(n), 10);
  return Number.isFinite(x) ? x : fallback;
}

function parseEuroToCents(text, fallbackCents) {
  if (text == null) return fallbackCents;
  const raw = String(text)
    .trim()
    .replace(/[€]/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!raw) return fallbackCents;
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num)) return fallbackCents;
  return Math.round(num * 100);
}

function setStickyHeaderOffset() {
  const header = document.querySelector(".header");
  if (!header) return;
  const h = Math.ceil(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--sticky-header-offset", `${h}px`);
}

function loadState() {
  // URL share import: #data=...
  try {
    const hash = (window.location.hash || "").replace(/^#/, "");
    if (hash.startsWith(SHARE_PREFIX)) {
      const payload = decodeURIComponent(hash.slice(SHARE_PREFIX.length));
      const json = JSON.parse(atob(payload));
      if (json && typeof json === "object") {
        // persist and clear hash so user doesn't keep re-importing
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
  } catch (_) {
    // ignore
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function uniqueLots(items) {
  const lots = new Set(items.map((x) => x.lot));
  return Array.from(lots).sort((a, b) => a - b);
}

function matchesQuery(item, q) {
  if (!q) return true;
  const hay = `${item.article} ${item.specification}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function statusLabel(s) {
  switch (s) {
    case "bought":
      return "Acheté";
    case "todo":
    default:
      return "À acheter";
  }
}

function normalizeStatus(s) {
  // Backward compatibility with earlier versions:
  // - done => bought
  // - ordered => todo
  if (s === "done") return "bought";
  if (s === "ordered") return "todo";
  if (s === "bought") return "bought";
  return "todo";
}

function makeStatusPill(status) {
  const wrap = document.createElement("span");
  wrap.className = "pill";
  const dot = document.createElement("span");
  dot.className = `dot ${status}`;
  const text = document.createElement("span");
  text.textContent = statusLabel(status);
  wrap.appendChild(dot);
  wrap.appendChild(text);
  return wrap;
}

function computeBudgetTotal(items) {
  return items.reduce((acc, x) => acc + (x.budget_total_cents || 0), 0);
}

function computeActualTotal(items, state) {
  let total = 0;
  for (const it of items) {
    const s = (state[it.id] || {});
    const actual = clampInt(s.actual_total_cents, it.budget_total_cents);
    total += actual;
  }
  return total;
}

function computeBoughtVsRemaining(items, state) {
  let boughtCents = 0;
  let remainingCents = 0;
  let boughtCount = 0;
  let remainingCount = 0;

  for (const it of items) {
    const s = (state[it.id] || {});
    const status = normalizeStatus(s.status || "todo");
    const val = clampInt(s.actual_total_cents, it.budget_total_cents);

    if (status === "bought") {
      boughtCents += val;
      boughtCount += 1;
    } else {
      remainingCents += val;
      remainingCount += 1;
    }
  }

  return { boughtCents, remainingCents, boughtCount, remainingCount };
}

function drawDonut(canvas, bought, remaining) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const size = 180;
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = size / 2;
  const cy = size / 2;
  const r = 72;
  const w = 18;
  const total = Math.max(1, bought + remaining);

  // background ring
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineWidth = w;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  const start = -Math.PI / 2;
  const boughtAngle = (bought / total) * Math.PI * 2;

  // bought gradient
  const g1 = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g1.addColorStop(0, "rgba(48,209,88,1)");
  g1.addColorStop(1, "rgba(122,255,199,0.85)");

  ctx.strokeStyle = g1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + boughtAngle);
  ctx.stroke();

  // remaining gradient
  const g2 = ctx.createLinearGradient(cx + r, cy - r, cx - r, cy + r);
  g2.addColorStop(0, "rgba(122,162,255,1)");
  g2.addColorStop(1, "rgba(255,95,109,0.65)");

  ctx.strokeStyle = g2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start + boughtAngle, start + Math.PI * 2);
  ctx.stroke();

  // center text
  const pct = Math.round((bought / total) * 100);
  ctx.fillStyle = "rgba(232,238,252,0.95)";
  ctx.font = "700 28px ui-sans-serif, system-ui, -apple-system";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${pct}%`, cx, cy - 8);
  ctx.fillStyle = "rgba(183,196,230,0.9)";
  ctx.font = "600 12px ui-sans-serif, system-ui, -apple-system";
  ctx.fillText("acheté", cx, cy + 16);
}

function render() {
  const items = window.TRAVAUX_ITEMS || [];
  const state = loadState();

  const lotFilter = document.getElementById("lotFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");
  const tbody = document.getElementById("itemsTbody");

  // init lot filter once
  if (!lotFilter.dataset.ready) {
    lotFilter.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "ALL";
    allOpt.textContent = "Tous";
    lotFilter.appendChild(allOpt);

    for (const lot of uniqueLots(items)) {
      const opt = document.createElement("option");
      opt.value = String(lot);
      opt.textContent = `Lot ${lot}`;
      lotFilter.appendChild(opt);
    }
    lotFilter.dataset.ready = "1";
  }

  const selectedLot = lotFilter.value || "ALL";
  const selectedStatus = statusFilter.value || "ALL";
  const query = searchInput.value || "";

  tbody.innerHTML = "";

  let shown = 0;
  for (const it of items) {
    if (selectedLot !== "ALL" && String(it.lot) !== selectedLot) continue;
    if (!matchesQuery(it, query)) continue;

    const s = state[it.id] || {};
    const status = normalizeStatus(s.status || "todo");
    if (selectedStatus !== "ALL" && status !== selectedStatus) continue;

    const actual = clampInt(s.actual_total_cents, it.budget_total_cents);

    const tr = document.createElement("tr");

    const tdLot = document.createElement("td");
    tdLot.textContent = String(it.lot);

    const tdArt = document.createElement("td");
    tdArt.textContent = it.article;

    const tdSpec = document.createElement("td");
    tdSpec.textContent = it.specification;

    const tdQty = document.createElement("td");
    tdQty.className = "num";
    tdQty.textContent = String(it.qty);

    const tdUnit = document.createElement("td");
    tdUnit.textContent = it.unit;

    const tdPU = document.createElement("td");
    tdPU.className = "num";
    tdPU.textContent = eur(it.pu_cents);

    const tdBudget = document.createElement("td");
    tdBudget.className = "num";
    tdBudget.textContent = eur(it.budget_total_cents);

    const tdActual = document.createElement("td");
    tdActual.className = "num";
    const actualInput = document.createElement("input");
    actualInput.className = "actual-input";
    actualInput.type = "text";
    actualInput.inputMode = "decimal";
    actualInput.value = eurInput(actual);
    if (actual > it.budget_total_cents) actualInput.classList.add("exceed");
    actualInput.title = "Entrez un total réel en € (ex: 200 ou 200,50).";
    actualInput.addEventListener("blur", () => {
      const v = parseEuroToCents(actualInput.value, it.budget_total_cents);
      if (!state[it.id]) state[it.id] = {};
      state[it.id].actual_total_cents = v;
      saveState(state);
      renderTotals(items, state);
      render(); // re-render to update formatting + exceed styling
    });
    tdActual.appendChild(actualInput);

    const tdStatus = document.createElement("td");
    const statusSel = document.createElement("select");
    statusSel.className = "status-select";
    for (const optVal of ["todo", "bought"]) {
      const opt = document.createElement("option");
      opt.value = optVal;
      opt.textContent = statusLabel(optVal);
      statusSel.appendChild(opt);
    }
    statusSel.value = status;
    statusSel.addEventListener("change", () => {
      if (!state[it.id]) state[it.id] = {};
      state[it.id].status = normalizeStatus(statusSel.value);
      saveState(state);
      renderTotals(items, state);
      render();
    });
    tdStatus.appendChild(makeStatusPill(status));
    tdStatus.appendChild(document.createElement("br"));
    tdStatus.appendChild(statusSel);

    const tdComment = document.createElement("td");
    const comment = document.createElement("input");
    comment.className = "comment";
    comment.type = "text";
    comment.placeholder = "Écrire un commentaire…";
    comment.value = (s.comment || "");
    comment.addEventListener("input", () => {
      if (!state[it.id]) state[it.id] = {};
      state[it.id].comment = comment.value;
      saveState(state);
    });
    tdComment.appendChild(comment);

    tr.appendChild(tdLot);
    tr.appendChild(tdArt);
    tr.appendChild(tdSpec);
    tr.appendChild(tdQty);
    tr.appendChild(tdUnit);
    tr.appendChild(tdPU);
    tr.appendChild(tdBudget);
    tr.appendChild(tdActual);
    tr.appendChild(tdStatus);
    tr.appendChild(tdComment);

    tbody.appendChild(tr);
    shown += 1;
  }

  renderTotals(items, state, shown);
}

function renderTotals(items, state, shownOverride) {
  const budget = computeBudgetTotal(items);
  const actual = computeActualTotal(items, state);
  const delta = actual - budget;

  document.getElementById("budgetTotal").textContent = eur(budget);
  document.getElementById("actualTotal").textContent = eur(actual);

  const deltaEl = document.getElementById("deltaTotal");
  const sign = delta === 0 ? "" : (delta > 0 ? "+" : "");
  deltaEl.textContent = `Δ ${sign}${eur(delta)}`;
  deltaEl.classList.remove("positive", "negative", "neutral");
  deltaEl.classList.add(delta > 0 ? "negative" : (delta < 0 ? "positive" : "neutral"));

  const shown = typeof shownOverride === "number" ? shownOverride : items.length;
  document.getElementById("lineCount").textContent = `${shown}`;
  document.getElementById("lineCount2").textContent = `sur ${items.length} lignes`;

  // Pie chart + legend
  const { boughtCents, remainingCents, boughtCount, remainingCount } = computeBoughtVsRemaining(items, state);
  const canvas = document.getElementById("buyPie");
  if (canvas) drawDonut(canvas, boughtCents, remainingCents);

  const totalLines = boughtCount + remainingCount;
  const pct = totalLines ? Math.round((boughtCount / totalLines) * 100) : 0;
  const legendBought = document.getElementById("legendBought");
  const legendRemaining = document.getElementById("legendRemaining");
  const legendFoot = document.getElementById("legendFoot");
  if (legendBought) legendBought.textContent = `${eur(boughtCents)} • ${boughtCount} ligne(s)`;
  if (legendRemaining) legendRemaining.textContent = `${eur(remainingCents)} • ${remainingCount} ligne(s)`;
  if (legendFoot) legendFoot.textContent = `Progression: ${pct}% (par nombre de lignes) — basé sur les statuts.`;
}

function wireActions() {
  const lotFilter = document.getElementById("lotFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");

  lotFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);
  searchInput.addEventListener("input", () => {
    // small debounce feel without complexity
    window.clearTimeout(searchInput._t);
    searchInput._t = window.setTimeout(render, 80);
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const state = loadState();
    const filename = `travaux63b_commentaires_${new Date().toISOString().slice(0, 10)}.json`;
    download(filename, JSON.stringify(state, null, 2));
  });

  document.getElementById("importInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("Bad JSON");
      saveState(parsed);
      render();
    } catch (err) {
      alert("Fichier invalide. Attendu: JSON exporté depuis ce site.");
    } finally {
      e.target.value = "";
    }
  });

  document.getElementById("shareBtn").addEventListener("click", async () => {
    const state = loadState();
    const payload = btoa(JSON.stringify(state));
    const url = `${window.location.origin}${window.location.pathname}#${SHARE_PREFIX}${encodeURIComponent(payload)}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Lien copié dans le presse-papiers.");
    } catch (_) {
      prompt("Copiez ce lien:", url);
    }
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("Réinitialiser commentaires et statuts sur cet appareil ?")) return;
    localStorage.removeItem(STORAGE_KEY);
    render();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setStickyHeaderOffset();
  window.addEventListener("resize", () => {
    window.clearTimeout(window.__stickyT);
    window.__stickyT = window.setTimeout(setStickyHeaderOffset, 80);
  });
  wireActions();
  render();
});

