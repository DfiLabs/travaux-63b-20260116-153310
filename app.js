/* global TRAVAUX_ITEMS */

const STORAGE_KEY = "travaux63b_comments_v1";
const VIEW_KEY = "travaux63b_view_v1";

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

function getBudgetCents(it, state) {
  const s = (state && state[it.id]) ? state[it.id] : {};
  const override = s && typeof s.budget_override_cents === "number" ? s.budget_override_cents : null;
  return override != null ? override : (it.budget_total_cents || 0);
}

function getActualCents(it, state) {
  const s = (state && state[it.id]) ? state[it.id] : {};
  if (s && typeof s.actual_total_cents === "number") return s.actual_total_cents;
  return getBudgetCents(it, state);
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function applyItemDefaults(items, state) {
  // Apply defaults only when the user has no existing value for that field.
  // IMPORTANT: this runs every time, but only writes to storage if something changed.
  // This way, newly-added items (like Communs/Toiture) get defaults automatically
  // without requiring a reset.
  let changed = false;
  for (const it of items) {
    if (!state[it.id]) {
      state[it.id] = {};
      changed = true;
    }
    const s = state[it.id];
    if (s && typeof s === "object") {
      if (!("status" in s) && it.default_status) {
        s.status = normalizeStatus(it.default_status);
        changed = true;
      }
      if (!("actual_total_cents" in s) && typeof it.default_actual_total_cents === "number") {
        s.actual_total_cents = it.default_actual_total_cents;
        changed = true;
      }
      if (!("comment" in s) && it.default_comment) {
        s.comment = it.default_comment;
        changed = true;
      }
    }
  }

  if (changed) saveState(state);
  return state;
}

function applyAssumedBudgets(items, state) {
  // One-time migration: if previous overrides were 0 (because unknown) and we now
  // have an assumed_budget_cents, set the override to the assumed value so it contributes
  // to totals immediately.
  const meta = state.__meta && typeof state.__meta === "object" ? state.__meta : {};
  const version = 2;
  if (meta.assumedBudgetsVersion === version) return state;

  let changed = false;
  for (const it of items) {
    if (typeof it.assumed_budget_cents !== "number") continue;
    if (!state[it.id] || typeof state[it.id] !== "object") state[it.id] = {};
    const s = state[it.id];

    const hasOverride = typeof s.budget_override_cents === "number";
    const overrideIsZero = hasOverride && s.budget_override_cents === 0;
    if (!hasOverride || overrideIsZero) {
      s.budget_override_cents = it.assumed_budget_cents;
      changed = true;
    }
    if (!("status" in s) && it.default_status) {
      s.status = normalizeStatus(it.default_status);
      changed = true;
    }
    const status = normalizeStatus(s.status || it.default_status || "todo");
    const actualIsMissing = !("actual_total_cents" in s);
    const actualIsZero = typeof s.actual_total_cents === "number" && s.actual_total_cents === 0;
    // For assumed already-bought lines: if actual is missing OR stuck at 0 from an old run,
    // set it to the assumed budget so the top totals match the table.
    // If the user *really* wants 0, they can edit "Réel (Total)" manually afterwards.
    if (status === "bought" && (actualIsMissing || actualIsZero)) {
      s.actual_total_cents = s.budget_override_cents;
      changed = true;
    }
  }

  state.__meta = { ...meta, assumedBudgetsVersion: version };
  if (changed) saveState(state);
  return state;
}

const PLANNING_WEEKS = [
  { id: "S1", range: "15–26 jan", tasks: ["Dépose/déblai appart + traçage complet", "Ouverture séjour ↔ chambre 1 (+ reprises immédiates)", "Commandes “long lead” : volets, clim, Velux, escalier"] },
  { id: "S2", range: "27 jan–9 fév", tasks: ["Élec 1ère passe (saignées/boîtes/gaines/tirages principaux)", "Plomberie 1ère passe (cuisine + SDB + préparation WC)"] },
  { id: "S3", range: "10–23 fév", tasks: ["WC sanibroyeur : arrivée eau + élec + refoulement + coffrage technique", "Début SDB : receveur/évacs + SPEC (1ère couche) + bandes d’angles"] },
  { id: "S4", range: "24 fév–9 mars", tasks: ["SDB : carrelage/faïence + joints + silicones", "Pose vasque/robinets + paroi + finitions plomberie"] },
  { id: "S5", range: "10–23 mars", tasks: ["Cuisine : meubles + plan + évier/mitigeur + raccordements + crédence", "Élec cuisine : circuits/prises dédiées (2e passe partielle)"] },
  { id: "S6", range: "24 mars–6 avr", tasks: ["Trémie + escalier : renforts + pose escalier + garde-corps (structure)", "Démarrage combles : débarras + plancher OSB/renforts"] },
  { id: "S7", range: "7–20 avr", tasks: ["Combles : isolation + pare-vapeur + ossature + pose Velux (météo OK)", "Combles : élec (prises/lumière)"] },
  { id: "S8", range: "21 avr–4 mai", tasks: ["Combles : placo + bandes/enduits (1ère passe)", "Appart : préparation sols (ragréage local si besoin)"] },
  { id: "S9", range: "5–18 mai", tasks: ["Sols : pose LVT/SPC + sous-couche + plinthes + seuils", "Peinture : enduits ponctuels + impression"] },
  { id: "S10", range: "19 mai–1 juin", tasks: ["Peinture : 2 couches + finitions", "Volets électriques : pose + raccord + réglages"] },
  { id: "S11", range: "2–15 juin", tasks: ["Clim bi-split : supports + liaisons + goulottes + condensats + mise en service", "Élec 2e passe : appareillage, luminaires, tests"] },
  { id: "S12", range: "16–30 juin", tasks: ["Réserves : retouches peinture, silicones, réglages portes/volets", "Nettoyage fin + livraison"] },
];

function getFeaturesState(state) {
  if (!state.__features || typeof state.__features !== "object") state.__features = {};
  if (!state.__features.planning || typeof state.__features.planning !== "object") state.__features.planning = {};
  return state.__features;
}

function applyFeatureDefaults(state) {
  const meta = state.__meta && typeof state.__meta === "object" ? state.__meta : {};
  const version = 1;
  if (meta.featuresAppliedVersion === version) return state;

  const features = getFeaturesState(state);
  // planning task defaults
  for (const w of PLANNING_WEEKS) {
    for (let i = 0; i < w.tasks.length; i += 1) {
      const id = `plan_${w.id}_${i}`;
      if (!features.planning[id]) features.planning[id] = { done: false };
    }
  }

  state.__meta = { ...meta, featuresAppliedVersion: version };
  saveState(state);
  return state;
}

function setView(view) {
  const v = (view === "achats" || view === "bought") ? "materials" : (view || "materials");
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("active", el.id === `view-${v}`);
  });
  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === v);
  });
  localStorage.setItem(VIEW_KEY, v);

  // Hide material filters + summary when not in materials (keep it simple)
  const controls = document.querySelector(".controls");
  const summary = document.querySelector(".summary");
  const hide = v !== "materials";
  if (controls) controls.classList.toggle("hidden", hide);
  if (summary) summary.classList.toggle("hidden", hide);

  setStickyHeaderOffset();
}

function wireViews() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  const saved = localStorage.getItem(VIEW_KEY);
  setView(saved || "materials");
}

function renderPlanning(state) {
  const container = document.getElementById("planning");
  if (!container) return;
  const features = getFeaturesState(state);
  container.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "planning-grid";

  for (const w of PLANNING_WEEKS) {
    const card = document.createElement("div");
    card.className = "week-card";

    const title = document.createElement("div");
    title.className = "week-title";
    title.textContent = `${w.id} (${w.range})`;

    const sub = document.createElement("div");
    sub.className = "week-sub";
    sub.textContent = `${w.tasks.length} tâche(s)`;

    card.appendChild(title);
    card.appendChild(sub);

    // Per-week progress + actions
    const ids = w.tasks.map((_, idx) => `plan_${w.id}_${idx}`);
    const doneCount = ids.reduce((acc, id) => acc + (features.planning[id]?.done ? 1 : 0), 0);
    const pct = Math.round((doneCount / Math.max(1, ids.length)) * 100);

    const progressWrap = document.createElement("div");
    progressWrap.className = "week-progress";
    const progressHead = document.createElement("div");
    progressHead.className = "progress-head";
    const pt = document.createElement("div");
    pt.className = "progress-title";
    pt.textContent = `Avancement: ${pct}%`;
    const ps = document.createElement("div");
    ps.className = "progress-sub";
    ps.textContent = `${doneCount}/${ids.length} cochées`;
    progressHead.appendChild(pt);
    progressHead.appendChild(ps);
    const pb = document.createElement("div");
    pb.className = "progress-bar";
    const pf = document.createElement("div");
    pf.className = "progress-fill";
    pf.style.width = `${pct}%`;
    pb.appendChild(pf);
    progressWrap.appendChild(progressHead);
    progressWrap.appendChild(pb);
    card.appendChild(progressWrap);

    const actions = document.createElement("div");
    actions.className = "week-actions";
    const allBtn = document.createElement("button");
    allBtn.className = "btn btn-secondary";
    allBtn.type = "button";
    allBtn.textContent = "Tout cocher";
    allBtn.addEventListener("click", () => {
      ids.forEach((id) => {
        if (!features.planning[id]) features.planning[id] = { done: false };
        features.planning[id].done = true;
      });
      saveState(state);
      render();
    });
    const noneBtn = document.createElement("button");
    noneBtn.className = "btn";
    noneBtn.type = "button";
    noneBtn.textContent = "Tout décocher";
    noneBtn.addEventListener("click", () => {
      ids.forEach((id) => {
        if (!features.planning[id]) features.planning[id] = { done: false };
        features.planning[id].done = false;
      });
      saveState(state);
      render();
    });
    actions.appendChild(allBtn);
    actions.appendChild(noneBtn);
    card.appendChild(actions);

    w.tasks.forEach((t, idx) => {
      const id = `plan_${w.id}_${idx}`;
      const entry = features.planning[id] || { done: false };
      features.planning[id] = entry;

      const row = document.createElement("div");
      row.className = "task";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!entry.done;
      cb.addEventListener("change", () => {
        entry.done = cb.checked;
        saveState(state);
      });

      const label = document.createElement("div");
      label.className = "task-label";
      label.textContent = t;

      row.appendChild(cb);
      row.appendChild(label);
      card.appendChild(row);
    });

    // Notes per week
    const noteId = `note_${w.id}`;
    if (!features.planning[noteId]) features.planning[noteId] = { note: "" };
    const notes = document.createElement("div");
    notes.className = "week-notes";
    const ta = document.createElement("textarea");
    ta.placeholder = "Notes / questions / dépendances…";
    ta.value = features.planning[noteId].note || "";
    ta.addEventListener("input", () => {
      features.planning[noteId].note = ta.value;
      saveState(state);
    });
    notes.appendChild(ta);
    card.appendChild(notes);

    grid.appendChild(card);
  }

  container.appendChild(grid);
}

function renderTopProgress(items, state) {
  // Materials progress (line-based)
  const { boughtCount, remainingCount, boughtCents, remainingCents } = computeBoughtVsRemaining(items, state);
  const totalLines = boughtCount + remainingCount;
  const pctLines = Math.round((boughtCount / Math.max(1, totalLines)) * 100);
  const fill = document.getElementById("materialsProgressFill");
  const text = document.getElementById("materialsProgressText");
  if (fill) fill.style.width = `${pctLines}%`;
  if (text) text.textContent = `${pctLines}% • ${boughtCount}/${totalLines} lignes achetées • ${eur(boughtCents)} / ${eur(boughtCents + remainingCents)}`;

  // Planning progress (task-based)
  const features = getFeaturesState(state);
  let totalTasks = 0;
  let doneTasks = 0;
  for (const w of PLANNING_WEEKS) {
    totalTasks += w.tasks.length;
    for (let i = 0; i < w.tasks.length; i += 1) {
      const id = `plan_${w.id}_${i}`;
      if (features.planning[id]?.done) doneTasks += 1;
    }
  }
  const pctTasks = Math.round((doneTasks / Math.max(1, totalTasks)) * 100);
  const pFill = document.getElementById("planningProgressFill");
  const pText = document.getElementById("planningProgressText");
  if (pFill) pFill.style.width = `${pctTasks}%`;
  if (pText) pText.textContent = `${pctTasks}% • ${doneTasks}/${totalTasks} tâches cochées`;
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

function uniqueRooms(items) {
  const rooms = new Set(items.map((x) => x.room || "—"));
  return Array.from(rooms).sort((a, b) => a.localeCompare(b, "fr"));
}

// Chronological-ish order (can be tweaked easily):
// First: already completed areas (Communs, Toiture), then the “logical” flow.
const ROOM_ORDER = [
  "Communs",
  "Toiture",
  "Général (Électricité)",
  "Combles",
  "Général (Plomberie)",
  "WC",
  "Salle de bain",
  "Cuisine",
  "Escalier / Trémie",
  "Sols (toutes pièces)",
  "Peintures (toutes pièces)",
  "Volets / Fenêtres",
  "Climatisation",
  "Général (Placo)",
  "Général",
  "Imprévus",
];

function roomSortKey(room) {
  const idx = ROOM_ORDER.indexOf(room);
  return idx === -1 ? 9999 : idx;
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

function computeBudgetTotal(items, state) {
  return items.reduce((acc, it) => acc + getBudgetCents(it, state), 0);
}

function computeActualTotal(items, state) {
  let total = 0;
  for (const it of items) {
    const actual = getActualCents(it, state);
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
    const val = getActualCents(it, state);

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
  const state = applyFeatureDefaults(applyAssumedBudgets(items, applyItemDefaults(items, loadState())));

  const roomFilter = document.getElementById("roomFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");
  const tbody = document.getElementById("itemsTbody");

  // init room filter once
  if (roomFilter && !roomFilter.dataset.ready) {
    roomFilter.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "ALL";
    allOpt.textContent = "Toutes";
    roomFilter.appendChild(allOpt);
    for (const room of uniqueRooms(items)) {
      const opt = document.createElement("option");
      opt.value = room;
      opt.textContent = room;
      roomFilter.appendChild(opt);
    }
    roomFilter.dataset.ready = "1";
  }

  const selectedRoom = (roomFilter && roomFilter.value) ? roomFilter.value : "ALL";
  const selectedStatus = statusFilter.value || "ALL";
  const query = searchInput.value || "";

  tbody.innerHTML = "";

  // Filter first
  const filtered = [];
  for (const it of items) {
    if (selectedRoom !== "ALL" && String(it.room || "") !== selectedRoom) continue;
    if (!matchesQuery(it, query)) continue;

    const s = state[it.id] || {};
    const status = normalizeStatus(s.status || "todo");
    if (selectedStatus !== "ALL" && status !== selectedStatus) continue;

    filtered.push(it);
  }

  // Group by room (pièce)
  const byRoom = new Map(); // room -> items[]
  for (const it of filtered) {
    const room = it.room || "—";
    const arr = byRoom.get(room) || [];
    arr.push(it);
    byRoom.set(room, arr);
  }

  // Sort rooms so that rooms with already-bought items appear first, then by ROOM_ORDER.
  const roomMeta = new Map(); // room -> { anyBought: boolean }
  for (const [room, list] of byRoom.entries()) {
    let anyBought = false;
    for (const it of list) {
      const s = state[it.id] || {};
      if (normalizeStatus(s.status || "todo") === "bought") {
        anyBought = true;
        break;
      }
    }
    roomMeta.set(room, { anyBought });
  }

  const rooms = Array.from(byRoom.keys()).sort((a, b) => {
    const ab = roomMeta.get(a)?.anyBought ? 0 : 1;
    const bb = roomMeta.get(b)?.anyBought ? 0 : 1;
    if (ab !== bb) return ab - bb; // anyBought first
    const ka = roomSortKey(a);
    const kb = roomSortKey(b);
    if (ka !== kb) return ka - kb;
    return a.localeCompare(b, "fr");
  });

  let shown = 0;
  for (const room of rooms) {
    const roomItems = (byRoom.get(room) || []).slice().sort((a, b) => {
      const sa = normalizeStatus((state[a.id] || {}).status || "todo");
      const sb = normalizeStatus((state[b.id] || {}).status || "todo");
      const ra = sa === "bought" ? 0 : 1;
      const rb = sb === "bought" ? 0 : 1;
      if (ra !== rb) return ra - rb; // bought first
      // fallback stable-ish ordering
      return String(a.article).localeCompare(String(b.article), "fr");
    });

    // Room header row
    let roomBudget = 0;
    let roomActual = 0;
    let roomBought = 0;
    for (const it of roomItems) {
      const s = state[it.id] || {};
      const st = normalizeStatus(s.status || "todo");
      roomBudget += getBudgetCents(it, state);
      roomActual += getActualCents(it, state);
      if (st === "bought") roomBought += 1;
    }
    const roomDelta = roomActual - roomBudget;
    const signRoom = roomDelta === 0 ? "" : (roomDelta > 0 ? "+" : "");

    const trGroup = document.createElement("tr");
    trGroup.className = "group-row";
    const tdGroup = document.createElement("td");
    tdGroup.colSpan = 9;
    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = `Pièce: ${room}`;
    const meta = document.createElement("div");
    meta.className = "group-meta";
    meta.textContent = `Budget ${eur(roomBudget)} • Réel ${eur(roomActual)} • Δ ${signRoom}${eur(roomDelta)} • Acheté ${roomBought}/${roomItems.length}`;
    tdGroup.appendChild(title);
    tdGroup.appendChild(meta);
    trGroup.appendChild(tdGroup);
    tbody.appendChild(trGroup);

    for (const it of roomItems) {
      const s = state[it.id] || {};
      const status = normalizeStatus(s.status || "todo");
      const actual = getActualCents(it, state);

      const tr = document.createElement("tr");

    const tdArt = document.createElement("td");
    tdArt.textContent = it.article;

    const tdSpec = document.createElement("td");
    tdSpec.textContent = it.specification;
    if (it.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = it.hint;
      tdSpec.appendChild(hint);
    }

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
      if (it.editable_budget) {
        const budgetInput = document.createElement("input");
        budgetInput.className = "budget-input";
        budgetInput.type = "text";
        budgetInput.inputMode = "decimal";
        budgetInput.placeholder = "€";
        const currentBudget = getBudgetCents(it, state);
        budgetInput.value = currentBudget ? eurInput(currentBudget) : "";
        budgetInput.title = "Budget total en € (ex: 120 ou 120,50).";
        budgetInput.addEventListener("blur", () => {
          const v = parseEuroToCents(budgetInput.value, 0);
          if (!state[it.id]) state[it.id] = {};
          state[it.id].budget_override_cents = v;
          saveState(state);
          render();
        });
        tdBudget.appendChild(budgetInput);
      } else {
        tdBudget.textContent = eur(getBudgetCents(it, state));
      }

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
      const v = parseEuroToCents(actualInput.value, getBudgetCents(it, state));
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
  }

  renderTotals(items, state, shown);
  renderPlanning(state);
  renderTopProgress(items, state);
}

function renderTotals(items, state, shownOverride) {
  const budget = computeBudgetTotal(items, state);
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

  // Budget par pièce
  const roomsTbody = document.getElementById("roomsTbody");
  if (roomsTbody) {
    const agg = new Map(); // room -> {budget, actual, lines, boughtLines}
    for (const it of items) {
      const room = it.room || "—";
      const s = (state[it.id] || {});
      const status = normalizeStatus(s.status || "todo");
      const actualLine = getActualCents(it, state);
      const entry = agg.get(room) || { budget: 0, actual: 0, lines: 0, boughtLines: 0 };
      entry.budget += getBudgetCents(it, state);
      entry.actual += actualLine;
      entry.lines += 1;
      if (status === "bought") entry.boughtLines += 1;
      agg.set(room, entry);
    }

    const rows = Array.from(agg.entries()).sort((a, b) => (b[1].budget - a[1].budget));
    roomsTbody.innerHTML = "";
    for (const [room, v] of rows) {
      const tr = document.createElement("tr");
      tr.className = "room-row";

      const tdRoom = document.createElement("td");
      tdRoom.textContent = room;

      const tdB = document.createElement("td");
      tdB.className = "num";
      tdB.textContent = eur(v.budget);

      const tdA = document.createElement("td");
      tdA.className = "num";
      tdA.textContent = eur(v.actual);

      const tdD = document.createElement("td");
      tdD.className = "num";
      const deltaRoom = v.actual - v.budget;
      const signRoom = deltaRoom === 0 ? "" : (deltaRoom > 0 ? "+" : "");
      tdD.textContent = `${signRoom}${eur(deltaRoom)}`;

      const tdL = document.createElement("td");
      tdL.className = "num";
      tdL.textContent = String(v.lines);

      const tdBL = document.createElement("td");
      tdBL.className = "num";
      tdBL.textContent = `${v.boughtLines}/${v.lines}`;

      tr.appendChild(tdRoom);
      tr.appendChild(tdB);
      tr.appendChild(tdA);
      tr.appendChild(tdD);
      tr.appendChild(tdL);
      tr.appendChild(tdBL);
      roomsTbody.appendChild(tr);
    }
  }
}

function wireActions() {
  const roomFilter = document.getElementById("roomFilter");
  const statusFilter = document.getElementById("statusFilter");
  const searchInput = document.getElementById("searchInput");

  if (roomFilter) roomFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);
  searchInput.addEventListener("input", () => {
    // small debounce feel without complexity
    window.clearTimeout(searchInput._t);
    searchInput._t = window.setTimeout(render, 80);
  });

}

document.addEventListener("DOMContentLoaded", () => {
  setStickyHeaderOffset();
  window.addEventListener("resize", () => {
    window.clearTimeout(window.__stickyT);
    window.__stickyT = window.setTimeout(setStickyHeaderOffset, 80);
  });
  wireViews();
  wireActions();
  render();
});

