// ═══════════════════════════════════════════════════════════════
// worldTick.js — Timer de tick do mundo + IA de monstros
// ═══════════════════════════════════════════════════════════════
import { initWorldStore, setTickRunning } from "../../../core/worldStore.js";
import {
  initMonsterManager,
  tickMonsters,
  tickFields,
} from "../../../gameplay/monsterManager.js";
import {
  watchPlayerActions,
  deletePlayerAction,
  deletePlayerActions,
} from "../../../core/db.js";
import {
  enqueueAction,
  processAction,
  flushQueuedActions,
} from "../../../gameplay/actionProcessor.js";
import { recordActionReceived } from "../../../core/metrics.js";
import {
  getCombatTickBucket,
  shouldRunCombatTick,
} from "../../../gameplay/combatScheduler.js";

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

    setTickRunning(true);
    this.worldState.tickCount = (this.worldState.tickCount ?? 0) + 1;

    const allowCombat = shouldRunCombatTick(this._lastCombatTickBucket, now);
    if (allowCombat) {
      this._lastCombatTickBucket = getCombatTickBucket(now);
      try {
        const processedActionIds = await flushQueuedActions(now);
        await deletePlayerActions(processedActionIds);
      } catch (e) {
        console.error("[WorldTick] Erro no flush de combate:", e);
      }
    }

    if (this._managerReady) {
      try {
        await tickMonsters({ now, allowCombat });
        await tickFields();
      } catch (e) {
        console.error("[WorldTick] Erro no tick de IA:", e);
      }
    }

    setTickRunning(false);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
