// =============================================================================
// adminPanel.js — WorldEngine Admin Panel
//
// Painel de ferramentas GM desacoplado para o WorldEngine.
// Responsabilidades:
//   • Spawn e remoção de monstros
//   • Teleporte para jogadores ("Go to Player")
//   • Chat GM → broadcast para todos os jogadores
//   • Log de eventos e mensagens recebidas
//
// Uso:
//   import { initAdminPanel } from './adminPanel.js';
//   initAdminPanel({ camera, getGameTime, adminId, adminName });
//
// Dependências: core/db.js, core/worldStore.js
// =============================================================================

import {
  syncMonster,
  removeMonster,
  clearMonsters,
  watchPlayers,
  watchMonsters,
  syncChat,
  watchChat,
} from "../../core/db.js";
import { getPlayers, getMonsters } from "../../core/worldStore.js";
import { makeMonster } from "../../core/schema.js";
import { MONSTER_TEMPLATES } from "../../gameplay/monsterData.js";
import { migrateMonstersToCurrentTemplates } from "../../gameplay/monsterMigration.js";

// ---------------------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------------------

const SPECIES = Object.entries(MONSTER_TEMPLATES).map(([id, template]) => ({
  id,
  name: template.name,
}));

// ---------------------------------------------------------------------------
// ESTADO INTERNO
// ---------------------------------------------------------------------------

let _camera = null; // { x, y } em tiles
let _adminId = "worldengine";
let _adminName = "WorldEngine";
let _getGameTime = () => Date.now();
let _monsterCount = 0;
let _unsubscribers = [];

// ---------------------------------------------------------------------------
// INICIALIZAÇÃO PÚBLICA
// ---------------------------------------------------------------------------

/**
 * Inicializa o painel admin e injeta a UI no elemento alvo.
 *
 * @param {Object} opts
 * @param {Object}   opts.camera      - Objeto { x, y } da câmera (mutável)
 * @param {Function} [opts.getGameTime] - () => timestamp
 * @param {string}   [opts.adminId]   - ID do admin (para chat)
 * @param {string}   [opts.adminName] - Nome exibido no chat
 * @param {string}   [opts.containerId='sidebar'] - ID do elemento container
 */
export function initAdminPanel({
  camera,
  getGameTime,
  adminId = "worldengine",
  adminName = "WorldEngine",
  containerId = "sidebar",
} = {}) {
  _camera = camera;
  _adminId = adminId;
  _adminName = adminName;
  if (typeof getGameTime === "function") _getGameTime = getGameTime;

  const container = document.getElementById(containerId);
  if (!container) {
    console.error("[adminPanel] container não encontrado:", containerId);
    return;
  }

  _buildUI(container);
  _bindFirebase();
}

/** Remove todos os listeners e limpa o painel. */
export function destroyAdminPanel() {
  _unsubscribers.forEach((u) => typeof u === "function" && u());
  _unsubscribers = [];
}

// ---------------------------------------------------------------------------
// CONSTRUÇÃO DO DOM
// ---------------------------------------------------------------------------

function _buildUI(container) {
  container.innerHTML = `
    <style>
      #admin-panel { font-family: monospace; color: #eee; }
      #admin-panel h3 { color: #aad4ff; font-size: 12px; text-transform: uppercase;
                        letter-spacing: 1px; margin: 16px 0 6px; border-bottom: 1px solid #444; padding-bottom: 4px; }
      #admin-panel .row { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
      #admin-panel label { font-size: 11px; color: #aaa; white-space: nowrap; }
      #admin-panel input, #admin-panel select {
        flex: 1; background: #1a1a2e; color: #eee; border: 1px solid #555;
        padding: 4px 6px; font-size: 11px; border-radius: 3px; }
      #admin-panel button {
        background: #2a3a5a; color: #aad4ff; border: 1px solid #4a6a9a;
        padding: 5px 8px; font-size: 11px; cursor: pointer; border-radius: 3px;
        width: 100%; margin: 3px 0; }
      #admin-panel button:hover { background: #3a5a8a; }
      #admin-panel button.danger { background: #5a2a2a; color: #ffaaaa; border-color: #9a4a4a; }
      #admin-panel button.danger:hover { background: #7a3a3a; }
      #admin-panel .badge { background: #333; padding: 2px 6px; border-radius: 10px;
                            font-size: 11px; color: #aaa; }
      #chat-log { height: 180px; overflow-y: auto; background: #111; border: 1px solid #333;
                  padding: 6px; font-size: 11px; border-radius: 3px; margin-bottom: 6px; }
      #chat-log .msg { margin: 2px 0; line-height: 1.4; }
      #chat-log .msg.gm   { color: #f1c40f; }
      #chat-log .msg.player { color: #7ec8e3; }
      #chat-log .msg.system { color: #aaa; font-style: italic; }
      #chat-input-wrap { display: flex; gap: 4px; }
      #chat-input { flex:1; background: #1a1a2e; color: #eee; border: 1px solid #555;
                    padding: 5px 8px; font-size: 11px; border-radius: 3px; }
      #chat-send { padding: 5px 10px; white-space: nowrap; width: auto; margin:0; }
    </style>

    <div id="admin-panel">
      <h2 style="font-size:14px; color:#eee; margin-bottom:4px;">⚙ World Engine</h2>
      <div class="row">
        <span class="badge">Z: <span id="stat-z">7</span></span>
        <span class="badge">Monstros: <span id="stat-monsters">0</span></span>
        <span class="badge">Jogadores: <span id="stat-players">0</span></span>
      </div>
      <div class="row" style="margin-top:2px;">
        <span class="badge">Tiles: <span id="stat-tiles">—</span></span>
        <span class="badge">Atlas: <span id="stat-atlas">—</span></span>
      </div>
      <div class="row">
        <button onclick="changeZ(1)">Z +1</button>
        <button onclick="changeZ(-1)">Z -1</button>
        <button onclick="toggleDebug()">Debug</button>
      </div>

      <!-- SPAWN MONSTER -->
      <h3>🐾 Spawn Monster</h3>
      <div class="row">
        <label>Tipo:</label>
        <select id="spawn-species">
          ${SPECIES.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}
        </select>
      </div>
      <div class="row">
        <label>X:</label><input id="spawn-x" type="number" value="100" style="width:60px">
        <label>Y:</label><input id="spawn-y" type="number" value="100" style="width:60px">
        <label>Z:</label><input id="spawn-z" type="number" value="7" style="width:45px">
      </div>
      <div class="row">
        <label>Qtd:</label><input id="spawn-qty" type="number" value="1" min="1" max="20" style="width:50px">
        <label>Spread:</label><input id="spawn-spread" type="number" value="3" min="0" max="10" style="width:50px">
      </div>
      <button id="btn-spawn">▶ Spawnar</button>
      <button id="btn-spawn-camera">▶ Spawnar no Centro da Câmera</button>

      <!-- REMOVE MONSTERS -->
      <h3>❌ Monstros</h3>
      <button id="btn-migrate-monsters">♻ Migrar Monstros Existentes</button>
      <button id="btn-remove-all" class="danger">🗑 Remover Todos os Monstros</button>
      <div id="monster-list" style="max-height:100px;overflow-y:auto;font-size:11px;color:#aaa;"></div>

      <!-- GO TO PLAYER -->
      <h3>🧭 Go to Player</h3>
      <div class="row">
        <select id="player-select" style="flex:1">
          <option value="">— aguardando jogadores —</option>
        </select>
      </div>
      <button id="btn-goto-player">📍 Ir Até o Jogador</button>

      <!-- CHAT GM -->
      <h3>💬 Chat (GM)</h3>
      <div id="chat-log"></div>
      <div id="chat-input-wrap">
        <input id="chat-input" type="text" placeholder="Mensagem para todos..." maxlength="120">
        <button id="chat-send" class="chat-send">Enviar</button>
      </div>
    </div>
  `;

  _bindButtons();
}

// ---------------------------------------------------------------------------
// BIND DOS BOTÕES
// ---------------------------------------------------------------------------

function _bindButtons() {
  document
    .getElementById("btn-spawn")
    .addEventListener("click", _spawnAtCoords);
  document
    .getElementById("btn-spawn-camera")
    .addEventListener("click", _spawnAtCamera);
  document
    .getElementById("btn-migrate-monsters")
    .addEventListener("click", _migrateMonsters);
  document
    .getElementById("btn-remove-all")
    .addEventListener("click", _removeAllMonsters);
  document
    .getElementById("btn-goto-player")
    .addEventListener("click", _gotoPlayer);

  const chatInput = document.getElementById("chat-input");
  document.getElementById("chat-send").addEventListener("click", _sendChat);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") _sendChat();
  });
}

// ---------------------------------------------------------------------------
// SPAWN MONSTER
// ---------------------------------------------------------------------------

function _makeMonsterData(species, x, y, z) {
  const template = MONSTER_TEMPLATES[species] ?? MONSTER_TEMPLATES.rat;
  const id = `mob_${species}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return makeMonster({
    id,
    species,
    name: template.name ?? species,
    type: "monster",
    schemaVersion: 2,
    recommendedPlayerLevel: template.recommendedPlayerLevel,
    threatTier: template.threatTier,
    x: Number(x),
    y: Number(y),
    z: Number(z),
    direcao: "frente",
    spawnX: Number(x),
    spawnY: Number(y),
    spawnZ: Number(z),
    speed: template.appearance?.speed,
    appearance: {
      ...template.appearance,
      isAdmin: false,
      class: null,
    },
    stats: { ...template.stats, mp: 0, maxMp: 0 },
    lastAiTick: 0,
    lastMoveTime: 0,
    lastAttack: 0,
    dead: false,
  });
}

function _spawnAtCoords() {
  const species = document.getElementById("spawn-species").value;
  const x = Number(document.getElementById("spawn-x").value);
  const y = Number(document.getElementById("spawn-y").value);
  const z = Number(document.getElementById("spawn-z").value);
  const qty = Math.min(
    20,
    Math.max(1, Number(document.getElementById("spawn-qty").value)),
  );
  const spread = Math.max(
    0,
    Number(document.getElementById("spawn-spread").value),
  );
  _doSpawn(species, x, y, z, qty, spread);
}

function _spawnAtCamera() {
  if (!_camera) {
    _logSystem("Câmera não disponível.");
    return;
  }
  const species = document.getElementById("spawn-species").value;
  const cx = Math.round(_camera.x);
  const cy = Math.round(_camera.y);
  const z = Number(document.getElementById("spawn-z").value);
  const qty = Math.min(
    20,
    Math.max(1, Number(document.getElementById("spawn-qty").value)),
  );
  const spread = Math.max(
    0,
    Number(document.getElementById("spawn-spread").value),
  );
  _doSpawn(species, cx, cy, z, qty, spread);
}

async function _doSpawn(species, cx, cy, z, qty, spread) {
  for (let i = 0; i < qty; i++) {
    const dx = spread > 0 ? Math.round((Math.random() - 0.5) * spread * 2) : 0;
    const dy = spread > 0 ? Math.round((Math.random() - 0.5) * spread * 2) : 0;
    const mob = _makeMonsterData(species, cx + dx, cy + dy, z);
    await syncMonster(mob.id, mob);
  }
  _logSystem(`✅ ${qty}x ${species} spawnado(s) em (${cx}, ${cy}, ${z})`);
}

// ---------------------------------------------------------------------------
// REMOVER MONSTROS
// ---------------------------------------------------------------------------

async function _removeAllMonsters() {
  if (!confirm("Remover TODOS os monstros do mundo?")) return;
  await clearMonsters();
  _logSystem("🗑 Todos os monstros removidos.");
}

async function _migrateMonsters() {
  const result = await migrateMonstersToCurrentTemplates({
    preserveHpPercent: true,
  });
  _logSystem(
    `♻ Migração concluída: ${result.migrated} migrado(s), ${result.skipped} ignorado(s).`,
  );
}

// ---------------------------------------------------------------------------
// GO TO PLAYER
// ---------------------------------------------------------------------------

function _gotoPlayer() {
  const sel = document.getElementById("player-select");
  const val = sel.value;
  if (!val) {
    _logSystem("Nenhum jogador selecionado.");
    return;
  }

  try {
    const [px, py] = val.split(",").map(Number);
    if (_camera) {
      _camera.x = px;
      _camera.y = py;
      _logSystem(`📍 Câmera movida para (${px}, ${py})`);
    }
  } catch {
    _logSystem("Erro ao mover câmera.");
  }
}

// ---------------------------------------------------------------------------
// CHAT GM
// ---------------------------------------------------------------------------

async function _sendChat() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";

  const id = `msg_gm_${Date.now()}`;
  await syncChat(id, {
    id,
    playerId: _adminId,
    name: _adminName,
    msg,
    x: _camera?.x ?? 0,
    y: _camera?.y ?? 0,
    z: 7,
    ts: _getGameTime(),
    isGM: true,
  });
}

// ---------------------------------------------------------------------------
// BIND FIREBASE (watchers)
// ---------------------------------------------------------------------------

function _bindFirebase() {
  // Watcher de jogadores
  const unsubPlayers = watchPlayers((data) => {
    const players = data ?? {};
    const count = Object.keys(players).length;
    const el = document.getElementById("stat-players");
    if (el) el.textContent = count;

    const sel = document.getElementById("player-select");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML =
      count === 0
        ? '<option value="">— nenhum jogador online —</option>'
        : Object.entries(players)
            .map(([id, p]) => {
              const name = p.name ?? id;
              const x = Math.round(p.x ?? 0);
              const y = Math.round(p.y ?? 0);
              return `<option value="${x},${y}">${name} (${x},${y})</option>`;
            })
            .join("");
    if (prev) {
      // Tenta manter a seleção anterior
      for (const opt of sel.options) {
        if (opt.value === prev) {
          sel.value = prev;
          break;
        }
      }
    }
  });

  // Watcher de monstros
  const unsubMonsters = watchMonsters((data) => {
    const monsters = data ?? {};
    _monsterCount = Object.keys(monsters).length;
    const el = document.getElementById("stat-monsters");
    if (el) el.textContent = _monsterCount;

    const listEl = document.getElementById("monster-list");
    if (listEl) {
      const entries = Object.values(monsters).slice(0, 20);
      listEl.innerHTML =
        entries
          .map(
            (m) =>
              `<div style="display:flex;justify-content:space-between;padding:1px 0;">
           <span>${m.name ?? m.species ?? "?"} (${Math.round(m.x)},${Math.round(m.y)})</span>
           <span style="color:#888">${m.stats?.hp ?? "?"}hp</span>
         </div>`,
          )
          .join("") +
        (_monsterCount > 20
          ? `<div style="color:#666">...e mais ${_monsterCount - 20}</div>`
          : "");
    }
  });

  // Watcher de chat
  const unsubChat = watchChat((msgs) => {
    if (!msgs) return;
    const sorted = Object.values(msgs).sort(
      (a, b) => (a.ts ?? 0) - (b.ts ?? 0),
    );
    const log = document.getElementById("chat-log");
    if (!log) return;
    log.innerHTML = sorted
      .map((m) => {
        const cls = m.isGM ? "gm" : "player";
        const name = m.isGM ? `[GM] ${m.name}` : m.name;
        return `<div class="msg ${cls}"><b>${name}:</b> ${_escapeHtml(m.msg ?? "")}</div>`;
      })
      .join("");
    log.scrollTop = log.scrollHeight;
  });

  _unsubscribers.push(unsubPlayers, unsubMonsters, unsubChat);
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function _logSystem(text) {
  const log = document.getElementById("chat-log");
  if (!log) return;
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
