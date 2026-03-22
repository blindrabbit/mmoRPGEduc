// ═══════════════════════════════════════════════════════════════
// eventLog.js — Painel de log unificado com deduplicação
// Usado por: worldEngine.html, RPG.html
// ═══════════════════════════════════════════════════════════════

const ICONS = {
  damage: "⚔️",
  death_player: "💀",
  death_monster: "🐉",
  heal: "💚",
  system: "⚙️",
  spawn: "🐾",
  move: "👣",
  field: "🔥",
  loot: "🎁",
  warn: "⚠️",
  error: "❌",
  rpg: "🎮",
  admin: "🛡️",
  engine: "🌐",
};

const TYPE_COLORS = {
  damage: "#e74c3c",
  death_player: "#e74c3c",
  death_monster: "#f39c12",
  heal: "#2ecc71",
  system: "#95a5a6",
  spawn: "#9b59b6",
  move: "#7f8c8d",
  field: "#e67e22",
  loot: "#f1c40f",
  warn: "#f1c40f",
  error: "#e74c3c",
};

// ─── Estado por instância ──────────────────────────────────────
// Cada panelId tem sua própria instância: { body, opts, lastEntry }
const _instances = new Map();

// Instância ativa para pushLog() sem argumento de painel
let _activeId = null;

function dedupKey(source, type, msg) {
  return `${source}|${type}|${msg}`;
}

function nowTS() {
  return new Date().toLocaleTimeString("pt-BR", { hour12: false });
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
export function initEventLog(opts = {}) {
  const cfg = {
    panelId: "log-panel",
    showSource: true,
    maxLines: 120,
    filters: ["all"],
    ...opts,
  };

  const panel = document.getElementById(cfg.panelId);
  if (!panel) return;

  // ── Header do painel ────────────────────────────────────────
  const header = document.createElement("div");
  header.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "padding:6px 10px",
    "background:#0d1117",
    "border-bottom:1px solid #1a2a3a",
    "flex-shrink:0",
  ].join(";");

  const title = document.createElement("span");
  title.style.cssText =
    "color:#2ecc71;font:bold 11px monospace;letter-spacing:1px";
  title.textContent = "◈ EVENT LOG";

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "limpar";
  clearBtn.style.cssText = [
    "background:none",
    "border:1px solid #333",
    "color:#666",
    "font:10px monospace",
    "padding:2px 8px",
    "cursor:pointer",
    "border-radius:3px",
  ].join(";");
  clearBtn.onclick = () => {
    const inst = _instances.get(cfg.panelId);
    if (inst) {
      inst.body.innerHTML = "";
      inst.lastEntry = null;
    }
  };

  header.appendChild(title);
  header.appendChild(clearBtn);
  panel.appendChild(header);

  // ── Corpo scrollável ─────────────────────────────────────────
  const body = document.createElement("div");
  body.style.cssText = [
    "flex:1",
    "overflow-y:auto",
    "padding:4px 0",
    "font:11px monospace",
    "scrollbar-width:thin",
    "scrollbar-color:#1a2a3a #0d1117",
  ].join(";");
  panel.appendChild(body);

  // Registra instância (substitui se já existia)
  _instances.set(cfg.panelId, { body, opts: cfg, lastEntry: null });

  // A primeira instância criada vira a ativa por padrão
  if (_activeId === null) _activeId = cfg.panelId;
}

// ═══════════════════════════════════════════════════════════════
// pushLog — API pública
// pushLog(type, msg, detail?)
// pushLog(source, type, msg, detail?)
// pushLog(panelId, source, type, msg, detail?)  ← opcional
// ═══════════════════════════════════════════════════════════════
export function pushLog(sourceOrType, typeOrMsg, msgOrDetail, detailOrUndef) {
  let source, type, msg, detail;

  // Suporta assinatura com 3 ou 4 args
  if (detailOrUndef !== undefined) {
    // pushLog(source, type, msg, detail)
    [source, type, msg, detail] = [
      sourceOrType,
      typeOrMsg,
      msgOrDetail,
      detailOrUndef,
    ];
  } else if (msgOrDetail !== undefined) {
    // pushLog(source, type, msg)  ou  pushLog(type, msg, detail)
    const knownTypes = Object.keys(ICONS);
    if (knownTypes.includes(typeOrMsg)) {
      [source, type, msg, detail] = [
        sourceOrType,
        typeOrMsg,
        msgOrDetail,
        undefined,
      ];
    } else {
      [source, type, msg, detail] = ["", sourceOrType, typeOrMsg, msgOrDetail];
    }
  } else {
    // pushLog(type, msg)
    [source, type, msg, detail] = ["", sourceOrType, typeOrMsg, undefined];
  }

  // Envia para todas as instâncias que aceitam esse tipo
  for (const [, inst] of _instances) {
    _pushToInstance(inst, source, type, msg, detail);
  }
}

// ── Envia para uma instância específica ──────────────────────
function _pushToInstance(inst, source, type, msg, detail) {
  const { body, opts } = inst;
  if (!body) return;

  const filters = opts.filters || ["all"];
  if (!filters.includes("all") && !filters.includes(type)) return;

  const ts = nowTS();
  const key = dedupKey(source, type, msg);

  // ── Deduplicação ────────────────────────────────────────────
  if (inst.lastEntry && inst.lastEntry.key === key) {
    inst.lastEntry.count++;
    inst.lastEntry.tsEl.textContent = ts;
    inst.lastEntry.countEl.textContent = ` ×${inst.lastEntry.count}`;
    inst.lastEntry.countEl.style.display = "inline";
    if (detail !== undefined && inst.lastEntry.detailEl) {
      inst.lastEntry.detailEl.textContent = detail;
    }
    body.scrollTop = body.scrollHeight;
    return;
  }

  // ── Nova linha ───────────────────────────────────────────────
  const row = document.createElement("div");
  row.style.cssText = [
    "display:flex",
    "align-items:baseline",
    "gap:4px",
    "padding:3px 10px",
    "border-bottom:1px solid #0d1117",
    "line-height:1.6",
    "transition:background 0.2s",
  ].join(";");
  row.onmouseenter = () => {
    row.style.background = "#111827";
  };
  row.onmouseleave = () => {
    row.style.background = "";
  };

  const tsEl = document.createElement("span");
  tsEl.style.cssText =
    "color:#4a5568;font-size:10px;flex-shrink:0;min-width:56px";
  tsEl.textContent = ts;

  const icon = ICONS[type] || "•";
  const iconEl = document.createElement("span");
  iconEl.textContent = icon;
  iconEl.style.cssText = "flex-shrink:0";

  let badgeEl = null;
  if (opts.showSource && source) {
    badgeEl = document.createElement("span");
    badgeEl.textContent = source;
    badgeEl.style.cssText = [
      `color:${TYPE_COLORS[source] || "#7f8c8d"}`,
      "font-size:9px",
      "opacity:0.7",
      "flex-shrink:0",
      "text-transform:uppercase",
      "letter-spacing:0.5px",
    ].join(";");
  }

  const msgEl = document.createElement("span");
  msgEl.textContent = msg;
  msgEl.style.cssText = `color:${TYPE_COLORS[type] || "#ccc"};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;

  let detailEl = null;
  if (detail !== undefined) {
    detailEl = document.createElement("span");
    detailEl.textContent = detail;
    detailEl.style.cssText =
      "color:#4a5568;font-size:10px;flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  }

  const countEl = document.createElement("span");
  countEl.style.cssText =
    "color:#f1c40f;font-size:10px;flex-shrink:0;display:none";

  row.appendChild(tsEl);
  row.appendChild(iconEl);
  if (badgeEl) row.appendChild(badgeEl);
  row.appendChild(msgEl);
  if (detailEl) row.appendChild(detailEl);
  row.appendChild(countEl);

  body.appendChild(row);
  body.scrollTop = body.scrollHeight;

  inst.lastEntry = { key, el: row, tsEl, countEl, detailEl, count: 1 };

  // ── Limite de linhas ─────────────────────────────────────────
  const maxLines = opts.maxLines || 120;
  while (body.children.length > maxLines) {
    body.removeChild(body.firstChild);
    if (inst.lastEntry && !body.contains(inst.lastEntry.el))
      inst.lastEntry = null;
  }
}
