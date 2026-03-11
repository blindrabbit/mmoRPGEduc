// =============================================================================
// WorldEngineCore.js — mmoRPGEduc
// Núcleo puro da lógica do jogo — AGNÓSTICO de ambiente
//
// Pode rodar em:
// • Web Worker (client-side background)
// • Main thread (fallback)
// • Node.js server (Solution 3 - futuro)
//
// Regras:
// • ZERO imports de DOM, Firebase, ou APIs de browser
// • Recebe estado serializado + ações → retorna updates serializados
// • Determinístico: mesma entrada = mesma saída
// =============================================================================

// REGRA: zero imports de DOM/Firebase/browser — este módulo roda em worker e Node.js.
// actionProcessor, monsterAI, fieldSystem e regenSystem ainda dependem de Firebase/DOM.
// Por ora o core implementa lógica própria; a integração com os sistemas legados
// ocorrerá na migração para Solution 3 (server-side).
import { EVENT_TYPES } from "../events.js";

// =============================================================================
// CLASSE PRINCIPAL
// =============================================================================

export class WorldEngineCore {
  constructor(config = {}) {
    this.config = {
      tickInterval: config.tickInterval || 100,
      maxEntitiesPerTick: config.maxEntitiesPerTick || 50,
      enableMonsterAI: config.enableMonsterAI ?? true,
      enableFieldSystem: config.enableFieldSystem ?? true,
      enableRegen: config.enableRegen ?? true,
      ...config,
    };

    // Estado interno (serializável)
    this.state = {
      players: new Map(),
      monsters: new Map(),
      fields: new Map(),
      effects: new Map(),
      lastTick: Date.now(),
      tickCount: 0,
    };

    // Fila de ações pendentes
    this._actionQueue = [];

    // Callbacks para eventos (injetados pelo ambiente)
    this._onEvent = null;
    this._onUpdate = null;

    // Flags de controle
    this._running = false;
    this._tickTimer = null;
  }

  // =============================================================================
  // INICIALIZAÇÃO
  // =============================================================================

  /**
   * Inicializa o engine com estado inicial
   * @param {Object} initialState - Estado serializado do jogo
   * @param {Object} options - Opções de inicialização
   */
  init(initialState = {}, options = {}) {
    // Carregar estado inicial (deserializar)
    if (initialState.players) {
      for (const [id, data] of Object.entries(initialState.players)) {
        this.state.players.set(id, { ...data });
      }
    }
    if (initialState.monsters) {
      for (const [id, data] of Object.entries(initialState.monsters)) {
        this.state.monsters.set(id, { ...data });
      }
    }
    if (initialState.fields) {
      for (const [id, data] of Object.entries(initialState.fields)) {
        this.state.fields.set(id, { ...data });
      }
    }

    this.state.lastTick = Date.now();
    this.state.tickCount = 0;

    // Configurar callbacks
    if (options.onEvent) this._onEvent = options.onEvent;
    if (options.onUpdate) this._onUpdate = options.onUpdate;

    this._emitEvent("engine:initialized", { timestamp: Date.now() });
    return true;
  }

  /**
   * Inicia o loop de ticks
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._startTickLoop();
    this._emitEvent("engine:started", { timestamp: Date.now() });
  }

  /**
   * Para o loop de ticks
   */
  stop() {
    this._running = false;
    if (this._tickTimer) {
      clearTimeout(this._tickTimer);
      this._tickTimer = null;
    }
    this._emitEvent("engine:stopped", { timestamp: Date.now() });
  }

  // =============================================================================
  // LOOP DE TICKS (CORAÇÃO DO ENGINE)
  // =============================================================================

  _startTickLoop() {
    const tick = () => {
      if (!this._running) return;

      const now = Date.now();
      const delta = now - this.state.lastTick;

      if (delta >= this.config.tickInterval) {
        this._processTick(now);
        this.state.lastTick = now;
        this.state.tickCount++;
      }

      // Agendar próximo tick (usar setTimeout para funcionar em worker/server)
      const nextDelay = Math.max(
        1,
        this.config.tickInterval - (Date.now() - now),
      );
      this._tickTimer = setTimeout(tick, nextDelay);
    };

    tick();
  }

  _processTick(now) {
    const updates = {
      players: {},
      monsters: {},
      fields: {},
      effects: {},
      events: [],
    };

    // 1. Processar ações pendentes (ataques, magias, movimentos)
    while (this._actionQueue.length > 0) {
      const action = this._actionQueue.shift();
      const result = this._processAction(action, now);
      if (result?.updates) {
        this._mergeUpdates(updates, result.updates);
      }
      if (result?.events) {
        updates.events.push(...result.events);
      }
    }

    // 2. Processar IA de monstros (limitado por tick para performance)
    if (this.config.enableMonsterAI) {
      const aiUpdates = this._processMonsterAI(now);
      this._mergeUpdates(updates, aiUpdates);
    }

    // 3. Processar campos persistentes (dano por tick)
    if (this.config.enableFieldSystem) {
      const fieldUpdates = this._processFieldTicks(now);
      this._mergeUpdates(updates, fieldUpdates);
    }

    // 4. Processar regeneração de HP/MP
    if (this.config.enableRegen) {
      const regenUpdates = this._processRegen(now);
      this._mergeUpdates(updates, regenUpdates);
    }

    // 5. Emitir updates para o ambiente (worker/main/server)
    if (
      Object.keys(updates.players).length > 0 ||
      Object.keys(updates.monsters).length > 0 ||
      updates.events.length > 0
    ) {
      if (this._onUpdate) {
        this._onUpdate({
          timestamp: now,
          tickCount: this.state.tickCount,
          ...updates,
        });
      }
    }

    // 6. Emitir eventos para UI/log
    for (const event of updates.events) {
      this._emitEvent(event.type, event.payload);
    }
  }

  // =============================================================================
  // PROCESSAMENTO DE AÇÕES
  // =============================================================================

  /**
   * Enfileira uma ação para processamento no próximo tick
   * @param {Object} action - Ação serializada
   */
  queueAction(action) {
    this._actionQueue.push({
      ...action,
      queuedAt: Date.now(),
    });
  }

  /**
   * Processa uma ação individual (wrapper para actionProcessor)
   * @private
   */
  _processAction(_action, _now) {
    try {
      // Nota: actionProcessor deve ser adaptado para receber estado do core
      // em vez de acessar Firebase/worldStore diretamente
      // Isso será parte da refatoração para Solution 3
      return {
        success: true,
        updates: {}, // Preencher com updates reais após refatoração
        events: [],
      };
    } catch (error) {
      console.error("[WorldEngineCore] Error processing action:", error);
      return { success: false, error: error.message };
    }
  }

  // =============================================================================
  // PROCESSAMENTO DE ENTIDADES
  // =============================================================================

  _processMonsterAI(now) {
    const updates = { monsters: {}, events: [] };
    let processed = 0;

    for (const [id, monster] of this.state.monsters.entries()) {
      if (processed >= this.config.maxEntitiesPerTick) break;
      if (monster.dead || monster.lastActionAt > now - 1000) continue;

      // IA básica: seguir jogador mais próximo no mesmo andar
      const nearestPlayer = this._findNearestPlayer(monster);
      if (nearestPlayer) {
        const dist = Math.hypot(
          monster.x - nearestPlayer.x,
          monster.y - nearestPlayer.y,
        );

        // Atacar se estiver perto o suficiente
        if (dist <= 1.5) {
          // Lógica de ataque (simplificada - delegar para combatService depois)
          updates.events.push({
            type: EVENT_TYPES.COMBAT_DAMAGE,
            payload: {
              attackerId: id,
              defenderId: nearestPlayer.id,
              damage: monster.stats?.atk ?? 5,
              timestamp: now,
            },
          });
          monster.lastActionAt = now;
        }
        // Mover em direção ao jogador se estiver em alcance de aggro
        else if (dist < 8) {
          const dx = Math.sign(nearestPlayer.x - monster.x);
          const dy = Math.sign(nearestPlayer.y - monster.y);
          const speed = monster.stats?.speed ?? 0.2;

          const newX = monster.x + dx * speed;
          const newY = monster.y + dy * speed;

          // Verificar colisão básica (pode ser expandido)
          if (!this._isPositionBlocked(newX, newY, monster.z ?? 7)) {
            monster.x = newX;
            monster.y = newY;
            monster.lastActionAt = now;

            updates.monsters[id] = {
              x: monster.x,
              y: monster.y,
              lastActionAt: monster.lastActionAt,
            };
          }
        }
      }

      processed++;
    }

    return updates;
  }

  _processFieldTicks(now) {
    const updates = { fields: {}, events: [] };

    for (const [id, field] of this.state.fields.entries()) {
      // Verificar se é hora do tick
      if (now < field.lastTick + field.tickRate) continue;

      // Aplicar dano/cura a entidades no campo
      const affected = this._getEntitiesInField(field);

      for (const entity of affected) {
        const isEnemy =
          entity.type !== field.casterType || entity.id !== field.casterId;

        if (field.tickDamage && field.affectEnemies && isEnemy) {
          const damage = this._calculateFieldDamage(field);
          updates.events.push({
            type: EVENT_TYPES.COMBAT_DAMAGE,
            payload: {
              attackerId: field.casterId,
              defenderId: entity.id,
              damage,
              damageType: field.damageType,
              isFieldDamage: true,
              timestamp: now,
            },
          });
        } else if (field.tickHeal && field.affectAllies && !isEnemy) {
          const heal = this._calculateFieldHeal(field);
          updates.events.push({
            type: EVENT_TYPES.COMBAT_DAMAGE,
            payload: {
              defenderId: entity.id,
              damage: -heal, // negativo = cura
              isHeal: true,
              timestamp: now,
            },
          });
        }
      }

      // Atualizar lastTick
      field.lastTick = now;
      updates.fields[id] = { lastTick: now };

      // Verificar expiração
      if (now >= field.expiry) {
        updates.events.push({
          type: EVENT_TYPES.FIELD_REMOVED,
          payload: { fieldId: id, timestamp: now },
        });
        // Marcar para remoção (será feito pelo ambiente)
        updates.fields[id].remove = true;
      }
    }

    return updates;
  }

  _processRegen(now) {
    const updates = { players: {} };

    for (const [id, player] of this.state.players.entries()) {
      if (!player.stats) continue;

      const statsUpdate = {};

      // Regenerar HP
      if (player.stats.hp < player.stats.maxHp) {
        const regen = player.stats.regenHp ?? 1;
        player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + regen);
        statsUpdate.hp = player.stats.hp;
        statsUpdate.lastRegen = now;
      }

      // Regenerar MP
      if (player.stats.mp < player.stats.maxMp) {
        const regen = player.stats.regenMp ?? 1;
        player.stats.mp = Math.min(player.stats.maxMp, player.stats.mp + regen);
        statsUpdate.mp = player.stats.mp;
      }

      // Emitir só se algo mudou — applyPlayersLocal espera { stats: { hp, mp } }
      if (Object.keys(statsUpdate).length > 0) {
        updates.players[id] = { stats: statsUpdate };
      }
    }

    return updates;
  }

  // =============================================================================
  // HELPERS DE ESTADO
  // =============================================================================

  _findNearestPlayer(monster) {
    let nearest = null;
    let minDist = Infinity;

    for (const player of this.state.players.values()) {
      if ((player.z ?? 7) !== (monster.z ?? 7)) continue;
      const dist = Math.hypot(player.x - monster.x, player.y - monster.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = player;
      }
    }

    return nearest;
  }

  _getEntitiesInField(field) {
    const entities = [];

    // Verificar jogadores
    for (const player of this.state.players.values()) {
      if ((player.z ?? 7) !== field.z) continue;
      if (
        Math.abs(player.x - field.x) <= 0.5 &&
        Math.abs(player.y - field.y) <= 0.5
      ) {
        entities.push({ id: player.id, type: "player", ...player });
      }
    }

    // Verificar monstros
    for (const monster of this.state.monsters.values()) {
      if ((monster.z ?? 7) !== field.z) continue;
      if (
        Math.abs(monster.x - field.x) <= 0.5 &&
        Math.abs(monster.y - field.y) <= 0.5
      ) {
        entities.push({ id: monster.id, type: "monster", ...monster });
      }
    }

    return entities;
  }

  _calculateFieldDamage(field) {
    if (!field.tickDamage) return 0;
    const { base, variance = 0.1 } = field.tickDamage;
    const roll = 1 - variance + Math.random() * variance * 2;
    return Math.max(1, Math.round(base * roll));
  }

  _calculateFieldHeal(field) {
    if (!field.tickHeal) return 0;
    const { base, variance = 0.1 } = field.tickHeal;
    const roll = 1 - variance + Math.random() * variance * 2;
    return Math.max(1, Math.round(base * roll));
  }

  _isPositionBlocked(x, y, z) {
    // Verificação básica de colisão
    // Pode ser expandida com mapa de colisões real
    for (const monster of this.state.monsters.values()) {
      if ((monster.z ?? 7) !== z) continue;
      if (Math.abs(monster.x - x) < 0.8 && Math.abs(monster.y - y) < 0.8) {
        return true;
      }
    }
    return false;
  }

  _mergeUpdates(target, source) {
    if (!source) return;

    for (const [key, value] of Object.entries(source)) {
      if (key === "events") {
        target.events = target.events || [];
        target.events.push(...value);
      } else if (typeof value === "object" && value !== null) {
        target[key] = target[key] || {};
        Object.assign(target[key], value);
      } else {
        target[key] = value;
      }
    }
  }

  _emitEvent(type, payload) {
    if (this._onEvent) {
      this._onEvent({ type, payload, timestamp: Date.now() });
    }
  }

  // =============================================================================
  // MÉTODOS PÚBLICOS PARA SYNC DE ESTADO
  // =============================================================================

  /**
   * Atualiza entidades no estado interno
   * @param {Object} entities - { players?, monsters?, fields?, effects? }
   */
  syncEntities(entities) {
    if (entities.players) {
      for (const [id, data] of Object.entries(entities.players)) {
        if (data.remove) {
          this.state.players.delete(id);
        } else {
          const existing = this.state.players.get(id) || {};
          this.state.players.set(id, { ...existing, ...data });
        }
      }
    }
    if (entities.monsters) {
      for (const [id, data] of Object.entries(entities.monsters)) {
        if (data.remove) {
          this.state.monsters.delete(id);
        } else {
          const existing = this.state.monsters.get(id) || {};
          this.state.monsters.set(id, { ...existing, ...data });
        }
      }
    }
    if (entities.fields) {
      for (const [id, data] of Object.entries(entities.fields)) {
        if (data.remove) {
          this.state.fields.delete(id);
        } else {
          const existing = this.state.fields.get(id) || {};
          this.state.fields.set(id, { ...existing, ...data });
        }
      }
    }
  }

  /**
   * Obtém snapshot serializado do estado atual
   * @returns {Object} Estado serializável
   */
  getSnapshot() {
    return {
      players: Object.fromEntries(this.state.players),
      monsters: Object.fromEntries(this.state.monsters),
      fields: Object.fromEntries(this.state.fields),
      effects: Object.fromEntries(this.state.effects),
      tickCount: this.state.tickCount,
      lastTick: this.state.lastTick,
    };
  }

  /**
   * Define callback para eventos
   */
  onEvent(callback) {
    this._onEvent = callback;
  }

  /**
   * Define callback para updates de estado
   */
  onUpdate(callback) {
    this._onUpdate = callback;
  }
}

// =============================================================================
// FACTORY PARA FACILITAR INSTANCIAÇÃO
// =============================================================================

export function createWorldEngine(config = {}) {
  return new WorldEngineCore(config);
}

// Funções legadas (actionProcessor, monsterAI) dependem de Firebase/DOM.
// A integração com o core ocorrerá na migração para Solution 3 (server-side).
