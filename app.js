/* global TRAVAUX_ITEMS */

const STORAGE_KEY = "travaux63b_comments_v1";
const SHARE_PREFIX = "data=";

function eur(cents) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
}

function clampInt(n, fallback = 0) {
  const x = Number.parseInt(String(n), 10);
  return Number.isFinite(x) ? x : fallback;
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
    case "todo":
      return "À acheter";
    case "ordered":
      return "Commandé";
    case "bought":
      return "Acheté";
    case "done":
      return "Fait / OK";
    default:
      return "À acheter";
  }
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
    const status = s.status || "todo";
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
    actualInput.inputMode = "numeric";
    actualInput.value = String(actual);
    if (actual > it.budget_total_cents) actualInput.classList.add("exceed");
    actualInput.title = "Entrez un total réel en CENTIMES (ex: 20000 = 200,00 €).";
    actualInput.addEventListener("change", () => {
      const v = clampInt(actualInput.value, it.budget_total_cents);
      if (!state[it.id]) state[it.id] = {};
      state[it.id].actual_total_cents = v;
      saveState(state);
      renderTotals(items, state);
      render(); // re-render to update exceed styling
    });
    tdActual.appendChild(actualInput);

    const tdStatus = document.createElement("td");
    const statusSel = document.createElement("select");
    statusSel.className = "status-select";
    for (const optVal of ["todo", "ordered", "bought", "done"]) {
      const opt = document.createElement("option");
      opt.value = optVal;
      opt.textContent = statusLabel(optVal);
      statusSel.appendChild(opt);
    }
    statusSel.value = status;
    statusSel.addEventListener("change", () => {
      if (!state[it.id]) state[it.id] = {};
      state[it.id].status = statusSel.value;
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
  wireActions();
  render();
});

