// actions.js
import {
  update,
  ref,
  get,
  set,
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-database.js";
import { db } from "../../../core/config.js"; // ← corrigido (era ../config.js)
import { MONSTER_TEMPLATES } from "../../../gameplay/monsterData.js";
import { syncMonster } from "../../../core/db.js"; // helper de escrita para entidades
import { makeMonster } from "../../../core/schema.js";

const GROUND_Z = 7; // ← térreo OTBM

// ─── Funções Lógicas ──────────────────────────────────────────────────────────

export async function applyDamage(playerId, amount) {
  const statsRef = ref(db, `players_data/${playerId}/stats`);
  const snap = await get(statsRef);
  if (!snap.exists()) return;

  const stats = snap.val();
  const newHp = Math.max(0, (stats.hp || 100) - amount);
  await update(statsRef, { hp: newHp });
  await update(ref(db, `online_players/${playerId}/stats`), { hp: newHp });

  // Morte: respawn no térreo
  if (newHp <= 0) {
    await update(ref(db, `players_data/${playerId}`), {
      x: 80,
      y: 80,
      z: GROUND_Z,
      "stats/hp": 100, // ← z 7 (era z 0)
    });
  }
}

export async function resetPlayerStatus(playerId) {
  const d = { hp: 100, maxHp: 100 };
  await update(ref(db, `players_data/${playerId}/stats`), d);
  await update(ref(db, `online_players/${playerId}/stats`), d);
}

export async function kickPlayer(playerId) {
  await set(ref(db, `online_players/${playerId}`), null);
}

export async function syncEntity(path, data) {
  return data ? update(ref(db, path), data) : set(ref(db, path), null);
}

// ─── Comandos do Menu GM ──────────────────────────────────────────────────────

const COMMANDS = [
  {
    label: "📌 Teleportar GM Aqui",
    color: "#fff",
    requirePlayer: false,
    action: (ctx) => {
      ctx.adminPos.x = ctx.targetTile.x;
      ctx.adminPos.y = ctx.targetTile.y;
      ctx.syncEntity(`online_players/GM_ADMIN`, ctx.adminPos);
      ctx.addLog(
        `GM teleportado para ${ctx.targetTile.x}, ${ctx.targetTile.y}`,
      );
    },
  },
  {
    label: "🧲 Puxar Player (Bring)",
    color: "#2ecc71",
    requirePlayer: true,
    action: async (ctx) => {
      const pos = {
        x: ctx.adminPos.x,
        y: ctx.adminPos.y,
        z: ctx.adminPos.z,
        direcao: "frente",
      };
      await update(ref(db, `players_data/${ctx.playerId}`), pos);
      await update(ref(db, `online_players/${ctx.playerId}`), {
        ...pos,
        lastMoveTime: Date.now(),
      });
      ctx.addLog(`Puxou ${ctx.players[ctx.playerId].name}`);
    },
  },
  {
    label: "💢 Dar Dano (-10 HP)",
    color: "#e67e22",
    requirePlayer: true,
    action: async (ctx) => {
      await applyDamage(ctx.playerId, 10);
      ctx.addLog(
        `Dano aplicado em ${ctx.players[ctx.playerId].name}`,
        "#e67e22",
      );
    },
  },
  {
    label: "💊 Curar Full",
    color: "#3498db",
    requirePlayer: true,
    action: async (ctx) => {
      await resetPlayerStatus(ctx.playerId);
      ctx.addLog(`${ctx.players[ctx.playerId].name} curado!`, "#3498db");
    },
  },
  {
    label: "👢 Kick Player",
    color: "#ff4d4d",
    requirePlayer: true,
    action: (ctx) => {
      if (confirm(`Kickar ${ctx.players[ctx.playerId].name}?`)) {
        kickPlayer(ctx.playerId);
        ctx.addLog(`${ctx.players[ctx.playerId].name} kickado.`, "#ff4d4d");
      }
    },
  },

  // Spawn dinâmico — gera um item para cada monstro em MONSTER_TEMPLATES
  ...Object.keys(MONSTER_TEMPLATES).map((speciesKey) => ({
    label: `🐾 Spawn ${MONSTER_TEMPLATES[speciesKey].name}`,
    color: "#f1c40f",
    requirePlayer: false,
    action: async (ctx) => {
      const template = MONSTER_TEMPLATES[speciesKey];
      const monsterId = `mob_${Date.now()}`;
      // build full monster object based on template
      const mobData = makeMonster({
        id: monsterId,
        species: speciesKey,
        name: template.name,
        type: "monster",
        x: ctx.targetTile.x,
        y: ctx.targetTile.y,
        z: ctx.adminPos.z ?? GROUND_Z,
        spawnX: ctx.targetTile.x,
        spawnY: ctx.targetTile.y,
        spawnZ: ctx.adminPos.z ?? GROUND_Z,
        direcao: "frente",
        stats: { ...template.stats },
        appearance: { ...template.appearance },
        lastMoveTime: Date.now(),
        // default AI state fields so monsterManager doesn't overwrite
        lastAiTick: Date.now(),
        respawnDelay: template.respawnDelay ?? 30000,
        corpseFrames: template.corpseFrames ?? [496, 497],
        corpseDuration: template.corpseDuration ?? 6000,
        // additional fields (cooldowns) left undefined until used
      });

      console.debug("[admin] spawning mob", mobData);
      await syncMonster(monsterId, mobData);
      ctx.addLog(
        `'${template.name}' invocado em ${ctx.targetTile.x},${ctx.targetTile.y}`,
      );
    },
  })),
];

// ─── Registro do Menu de Contexto ─────────────────────────────────────────────

/**
 * Registra o menu de contexto no canvas do admin.
 * @param {Object} context - { canvas, ctxMenu, players, hoverTile, adminPos, addLog, syncEntity }
 */
export function registerActions(context) {
  const { canvas, ctxMenu, players, hoverTile, adminPos, addLog, syncEntity } =
    context;
  const dynamicContainer = document.getElementById("dynamic-actions");

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();

    const targetTile = {
      x: Math.round(hoverTile.x),
      y: Math.round(hoverTile.y),
    };

    // Detecta player no tile clicado
    const playerId = Object.keys(players).find((id) => {
      const p = players[id];
      if (id === "GM_ADMIN" || !p) return false;
      return (
        Math.abs(p.x - targetTile.x) < 0.6 && Math.abs(p.y - targetTile.y) < 0.6
      );
    });

    // Cabeçalho do menu
    const menuInfo = document.getElementById("menu-info");
    menuInfo.innerText = playerId
      ? `👤 PLAYER: ${players[playerId].name}`
      : `📍 COORD: ${targetTile.x}, ${targetTile.y} | Z: ${adminPos.z ?? GROUND_Z}`;
    menuInfo.style.color = playerId ? "#2ecc71" : "#888";

    // Popula ações
    dynamicContainer.innerHTML = "";
    COMMANDS.forEach((cmd) => {
      if (cmd.requirePlayer && !playerId) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.innerText = cmd.label;
      btn.style.color = cmd.color;
      btn.onclick = () => {
        cmd.action({
          playerId,
          targetTile,
          adminPos,
          players,
          addLog,
          syncEntity,
        });
        ctxMenu.style.display = "none";
      };
      dynamicContainer.appendChild(btn);
    });

    ctxMenu.style.display = "flex";
    ctxMenu.style.left = `${e.pageX}px`;
    ctxMenu.style.top = `${e.pageY}px`;
  });

  document.addEventListener("click", (e) => {
    if (!ctxMenu.contains(e.target)) ctxMenu.style.display = "none";
  });
}
