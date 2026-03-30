// ═══════════════════════════════════════════════════════════════
// worldTick.js — Timer de tick do mundo + IA de monstros
// ═══════════════════════════════════════════════════════════════
import {
  initWorldStore,
  destroyWorldStore,
  setTickRunning,
  getPlayers,
} from "../../../core/worldStore.js";
import {
  initMonsterManager,
  tickMonsters,
  tickFields,
} from "../../../gameplay/monsterManager.js";
import {
  initSpawnManager,
  tickSpawnManager,
} from "../../../gameplay/spawnManager.js";
import {
  watchPlayerActions,
  deletePlayerAction,
  deletePlayerActions,
  removePlayer,
} from "../../../core/db.js";
import {
  enqueueAction,
  processAction,
  flushQueuedActions,
  tickExpiredBuffs,
} from "../../../gameplay/actionProcessor.js";
import { recordActionReceived } from "../../../core/metrics.js";
import {
  getCombatTickBucket,
  shouldRunCombatTick,
} from "../../../gameplay/combatScheduler.js";
import { cooldownManager } from "../../../core/CooldownManager.js";

// Players sem heartbeat por mais de STALE_MS são considerados desconectados.
// O onDisconnect do Firebase já cuida da maioria dos casos; este é o safety-net.
const STALE_MS = 2 * 60 * 1000; // 2 min  — com heartbeat (lastSeen)
const STALE_MOVE_MS = 5 * 60 * 1000; // 5 min  — fallback via lastMoveTime
// Verificar a cada ~30s (120 ticks × 250ms)
const STALE_CHECK_INTERVAL = 120;

export class WorldTick {
  /**
   * @param {import("../../../core/worldState.js").WorldState} worldState
   * @param {number} intervalMs
   * @param {import("../engine/bootLogger.js").BootLogger} logger
   */
  constructor(worldState, intervalMs = 250, logger) {
    this.worldState = worldState;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this._timer = null;
  }

  start() {
    // Inicia watchers Firebase (monsters, players, effects, fields, chat)
    initWorldStore();

    // Carrega dados de spawn do mapa (assíncrono, não bloqueia o boot)
    this._spawnsData = null;
    this._spawnManagerReady = false;
    fetch("assets/monster_spawns.json")
      .then((r) => r.json())
      .then((data) => {
        this._spawnsData = data;
      })
      .catch((err) =>
        console.warn("[WorldTick] Nao foi possivel carregar monster_spawns.json:", err),
      );

    // Processa ações de player (attack, spell) em tempo real via Firebase.
    // Elas ficam enfileiradas e só são resolvidas na janela central de combate.
    watchPlayerActions(async (actionId, action) => {
      if (!actionId || !action) return;
      recordActionReceived();

      try {
        const result = await processAction(actionId, action, Date.now());
        if (result?.consumed) {
          deletePlayerAction(actionId).catch(() => {});
          return;
        }
      } catch (e) {
        console.warn(
          "[WorldTick] processAction imediato falhou, caindo para fila",
          e,
        );
      }

      enqueueAction(actionId, action);
    });

    this._timer = setInterval(() => this._tick(), this.intervalMs);
  }

  async _tick() {
    const now = Date.now();

    // Inicializa o monsterManager com o mapa na primeira vez que
    // ele estiver disponível (mapa carrega depois do boot)
    if (
      !this._managerReady &&
      this.worldState.map &&
      Object.keys(this.worldState.map).length > 0
    ) {
      initMonsterManager(this.worldState.map, this.worldState.mapData ?? {});
      this._managerReady = true;
      this.logger?.ok("[WorldTick] MonsterManager iniciado.");
    }

    // Inicializa SpawnManager assim que o MonsterManager estiver pronto e o JSON carregado
    if (this._managerReady && this._spawnsData && !this._spawnManagerReady) {
      initSpawnManager(this._spawnsData);
      this._spawnManagerReady = true;
      this.logger?.ok("[WorldTick] SpawnManager iniciado.");
    }

    setTickRunning(true);
    this.worldState.tickCount = (this.worldState.tickCount ?? 0) + 1;

    // ✅ Limpa cooldowns expirados (anti-memory-leak)
    cooldownManager.tick(now);

    const allowCombat = shouldRunCombatTick(this._lastCombatTickBucket, now);
    if (allowCombat) {
      this._lastCombatTickBucket = getCombatTickBucket(now);
      try {
        const processedActionIds = await flushQueuedActions(now);
        await deletePlayerActions(processedActionIds);
        await tickExpiredBuffs(now);
      } catch (e) {
        console.error("[WorldTick] Erro no flush de combate:", e);
      }
    }

    if (this._managerReady) {
      try {
        await tickMonsters({ now, allowCombat });
        await tickFields();
        if (this._spawnManagerReady) {
          await tickSpawnManager({ now });
        }
      } catch (e) {
        console.error("[WorldTick] Erro no tick de IA:", e);
      }
    }

    // Limpeza periódica de players obsoletos (sem heartbeat por > STALE_MS)
    if (this.worldState.tickCount % STALE_CHECK_INTERVAL === 0) {
      await this._cleanStalePlayers(now);
    }

    setTickRunning(false);
  }

  async _cleanStalePlayers(now) {
    const players = getPlayers() ?? {};
    for (const [id, player] of Object.entries(players)) {
      const lastSeen = player?.lastSeen ?? 0;
      const lastMove = player?.lastMoveTime ?? 0;
      let stale = false;

      if (lastSeen > 0) {
        // Heartbeat ativo: timeout curto (2 min)
        stale = now - lastSeen > STALE_MS;
      } else if (lastMove > 0) {
        // Sem heartbeat (cliente antigo ou falha): usa último movimento (5 min)
        stale = now - lastMove > STALE_MOVE_MS;
      }
      // Se nenhum timestamp existe, não toca — evita remover admin/spectator

      if (stale) {
        this.logger?.warn(`[WorldTick] Player inativo removido: ${id}`);
        await removePlayer(id).catch(() => {});
      }
    }
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    destroyWorldStore();
  }
}
