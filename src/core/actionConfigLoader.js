// ═══════════════════════════════════════════════════════════════
// actionConfigLoader.js — Carregador de ações configuradas via JSON
// Permite criar eventos/ações sem modificar o núcleo do sistema
// ═══════════════════════════════════════════════════════════════

import { getActionSystem } from "./actionSystem.js";
import { PlayerAction } from "./playerAction.js";
import { dbSet, batchWrite, PATHS } from "./db.js";
import { worldEvents, EVENT_TYPES } from "./events.js";

// Função para acessar dbSet e PATHS (pode ser null em alguns contextos)
function requireStorage() {
  return { dbSet, PATHS };
}

/**
 * @typedef {Object} ActionConfig
 * @property {string} id - ID único da ação
 * @property {string} type - Tipo de ação (position, item, event)
 * @property {number} [spriteId] - ID do sprite (para type: item)
 * @property {number} [x] - Posição X (para type: position)
 * @property {number} [y] - Posição Y (para type: position)
 * @property {number} [z] - Posição Z (para type: position)
 * @property {string} [action] - PlayerAction para executar
 * @property {Object} [conditions] - Condições para executar
 * @property {Object} [effects] - Efeitos ao executar
 * @property {Object} [messages] - Mensagens para exibir
 */

/**
 * @typedef {Object} ActionConditions
 * @property {number} [minLevel] - Nível mínimo do player
 * @property {number} [minStorage] - Valor mínimo de storage
 * @property {string} [storageKey] - Chave de storage para verificar
 * @property {Array<string>} [requiredItems] - IDs de itens necessários
 * @property {number} [distance] - Distância máxima do player
 */

/**
 * @typedef {Object} ActionEffects
 * @property {Object} [teleportTo] - Teleporta para {x, y, z}
 * @property {number} [floorChange] - Muda floor (+1 ou -1)
 * @property {Object} [damage] - Dano { amount, type }
 * @property {Object} [heal] - Cura { amount }
 * @property {Object} [setStorage] - Define storage { key, value }
 * @property {Object} [removeItem] - Remove item { itemId, count }
 * @property {string} [spawnCreature] - ID da creature para spawnar
 * @property {string} [playEffect] - ID do efeito para tocar
 * @property {string} [playSound] - ID do som para tocar
 */

/**
 * Carrega e registra ações configuradas via JSON
 */
export class ActionConfigLoader {
  constructor(worldState) {
    this.worldState = worldState;
    this.actionSystem = getActionSystem();
    this.registeredActions = new Map();
    this.eventListeners = new Map();
  }

  /**
   * Carrega configurações de um objeto JSON
   * @param {Object} config - Objeto de configuração
   * @returns {number} Número de ações registradas
   */
  loadFromJSON(config) {
    if (!config?.actions || !Array.isArray(config.actions)) {
      console.warn(
        "[ActionConfigLoader] Config inválida: actions array esperado",
      );
      return 0;
    }

    let registered = 0;

    for (const actionConfig of config.actions) {
      if (this.registerAction(actionConfig)) {
        registered++;
      }
    }

    console.log(`[ActionConfigLoader] ${registered} ações registradas.`);
    return registered;
  }

  /**
   * Carrega configurações de uma URL (Firebase, HTTP, etc)
   * @param {string} url - URL do JSON
   * @returns {Promise<number>}
   */
  async loadFromURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const config = await response.json();
      return this.loadFromJSON(config);
    } catch (error) {
      console.error("[ActionConfigLoader] Erro ao carregar de URL:", error);
      return 0;
    }
  }

  /**
   * Registra uma ação configurada
   * @param {ActionConfig} config
   * @returns {boolean}
   */
  registerAction(config) {
    if (!config?.id) {
      console.warn("[ActionConfigLoader] Ação sem ID, ignorada.");
      return false;
    }

    // Verifica se já existe
    if (this.registeredActions.has(config.id)) {
      console.warn(
        `[ActionConfigLoader] Ação '${config.id}' já existe, sobrescrita.`,
      );
    }

    // Cria handler baseado no tipo
    const handler = this.createHandler(config);
    if (!handler) return false;

    // Registra baseado no tipo
    if (config.type === "position" && config.x != null && config.y != null) {
      this.actionSystem.registerPositionAction(
        config.x,
        config.y,
        config.z ?? 7,
        handler,
      );
    } else if (config.type === "item" && config.spriteId) {
      this.actionSystem.registerItemAction(config.spriteId, handler);
    } else {
      console.warn(
        `[ActionConfigLoader] Tipo inválido ou faltando params:`,
        config,
      );
      return false;
    }

    this.registeredActions.set(config.id, { config, handler });
    return true;
  }

  /**
   * Cria handler baseado na configuração
   */
  createHandler(config) {
    return (ctx) => {
      const { player, target, metadata } = ctx;

      // Verifica condições
      if (config.conditions && !this.checkConditions(config.conditions, ctx)) {
        if (config.messages?.conditionFailed) {
          this.showMessage(config.messages.conditionFailed, ctx);
        }
        return false;
      }

      // Executa ação padrão se definida
      if (config.action) {
        this.actionSystem.execute(config.action, ctx);
      }

      // Executa efeitos
      if (config.effects) {
        this.applyEffects(config.effects, ctx);
      }

      // Emite evento customizado
      if (config.onTrigger) {
        this.emitCustomEvent(config.onTrigger, ctx);
      }

      // Mostra mensagem de sucesso
      if (config.messages?.success) {
        this.showMessage(config.messages.success, ctx);
      }

      return true;
    };
  }

  /**
   * Verifica condições para executar ação
   */
  checkConditions(conditions, ctx) {
    const { player } = ctx;

    // Nível mínimo
    if (conditions.minLevel) {
      const playerLevel = player.stats?.level ?? 1;
      if (playerLevel < conditions.minLevel) return false;
    }

    // Storage value
    if (conditions.storageKey) {
      const storageValue = player.storage?.[conditions.storageKey] ?? 0;
      const minValue = conditions.minStorage ?? 1;
      if (storageValue < minValue) return false;
    }

    // Itens necessários
    if (conditions.requiredItems && Array.isArray(conditions.requiredItems)) {
      const inventory = player.inventory ?? {};
      for (const itemId of conditions.requiredItems) {
        const hasItem = Object.values(inventory).some(
          (item) => (item.id ?? item.tileId) === Number(itemId),
        );
        if (!hasItem) return false;
      }
    }

    // Distância máxima
    if (conditions.distance != null) {
      const dx = Math.abs(player.x - ctx.target.x);
      const dy = Math.abs(player.y - ctx.target.y);
      const distance = Math.max(dx, dy); // Chebyshev
      if (distance > conditions.distance) return false;
    }

    return true;
  }

  /**
   * Aplica efeitos da ação
   */
  applyEffects(effects, ctx) {
    const { player, target } = ctx;

    // Teleporte
    if (effects.teleportTo) {
      const { x, y, z } = effects.teleportTo;
      player.x = x;
      player.y = y;
      player.z = z ?? player.z;

      if (player.id) {
        batchWrite({
          [`${PATHS.playerData(player.id)}/x`]: x,
          [`${PATHS.playerData(player.id)}/y`]: y,
          [`${PATHS.playerData(player.id)}/z`]: z ?? player.z,
          [`${PATHS.player(player.id)}/x`]: x,
          [`${PATHS.player(player.id)}/y`]: y,
          [`${PATHS.player(player.id)}/z`]: z ?? player.z,
        }).catch(err => console.error("[ActionEffect] Erro ao salvar teleporte:", err));
      }
    }

    // Mudança de floor
    if (effects.floorChange) {
      const newZ = (player.z ?? 7) + effects.floorChange;
      player.z = newZ;

      if (player.id) {
        batchWrite({
          [`${PATHS.playerData(player.id)}/z`]: newZ,
          [`${PATHS.player(player.id)}/z`]: newZ,
        }).catch(err => console.error("[ActionEffect] Erro ao salvar floorChange:", err));
      }
    }

    // Dano
    if (effects.damage) {
      const { amount, type = "physical" } = effects.damage;
      this.applyDamage(player, amount, type);
    }

    // Cura
    if (effects.heal) {
      const { amount } = effects.heal;
      this.applyHeal(player, amount);
    }

    // Set storage
    if (effects.setStorage) {
      const { key, value } = effects.setStorage;
      if (!player.storage) player.storage = {};
      player.storage[key] = value;
      console.log("[ActionEffect] Storage set:", key, "=", value);

      // Persiste no Firebase
      if (player.id) {
        const { dbSet, PATHS } = requireStorage();
        if (dbSet && PATHS) {
          dbSet(PATHS.playerStorage(player.id, key), value).catch((err) =>
            console.error("[ActionEffect] Erro ao salvar storage:", err),
          );
        }
      }
    }

    // Remove item
    if (effects.removeItem) {
      const { itemId, count = 1 } = effects.removeItem;
      this.removeItem(player, itemId, count);
    }

    // Spawn creature
    if (effects.spawnCreature) {
      this.spawnCreature(target, effects.spawnCreature);
    }

    // Play effect
    if (effects.playEffect) {
      this.playEffect(target, effects.playEffect);
    }

    // Play sound
    if (effects.playSound) {
      this.playSound(target, effects.playSound);
    }
  }

  /**
   * Aplica dano ao player
   */
  applyDamage(player, amount, type) {
    const currentHp = player.stats?.hp ?? 100;
    const newHp = Math.max(0, currentHp - amount);

    if (player.stats) {
      player.stats.hp = newHp;
    }

    if (player.id) {
      batchWrite({
        [`${PATHS.playerData(player.id)}/stats/hp`]: newHp,
        [`${PATHS.player(player.id)}/stats/hp`]: newHp,
      }).catch(err => console.error("[ActionEffect] Erro ao salvar dano:", err));
    }

    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, { playerId: player.id, amount, type, newHp });
    this.emitEvent("actionDamage", { playerId: player.id, amount, type, newHp });
  }

  /**
   * Aplica cura ao player
   */
  applyHeal(player, amount) {
    const currentHp = player.stats?.hp ?? 100;
    const maxHp = player.stats?.maxHp ?? 100;
    const newHp = Math.min(maxHp, currentHp + amount);

    if (player.stats) {
      player.stats.hp = newHp;
    }

    if (player.id) {
      batchWrite({
        [`${PATHS.playerData(player.id)}/stats/hp`]: newHp,
        [`${PATHS.player(player.id)}/stats/hp`]: newHp,
      }).catch(err => console.error("[ActionEffect] Erro ao salvar cura:", err));
    }

    worldEvents.emit(EVENT_TYPES.HEAL_RECEIVED ?? "heal:received", { playerId: player.id, amount, newHp });
    this.emitEvent("actionHeal", { playerId: player.id, amount, newHp });
  }

  /**
   * Remove item do inventory
   */
  removeItem(player, itemId, count) {
    if (!player.inventory) return;

    let remaining = count;
    for (const [slotKey, item] of Object.entries(player.inventory)) {
      if (remaining <= 0) break;

      const itemSpriteId = item.id ?? item.tileId;
      if (itemSpriteId === Number(itemId)) {
        const itemQuantity = item.quantity ?? item.count ?? 1;
        if (itemQuantity <= remaining) {
          delete player.inventory[slotKey];
          remaining -= itemQuantity;
        } else {
          item.quantity = itemQuantity - remaining;
          remaining = 0;
        }
      }
    }

    console.log(`[ActionEffect] Removeu ${count - remaining}x item ${itemId}`);
  }

  /**
   * Spawn creature
   */
  spawnCreature(target, creatureId) {
    console.log(
      `[ActionEffect] Spawn creature ${creatureId} em ${target.x}, ${target.y}`,
    );
    this.emitEvent("spawnCreature", {
      creatureId,
      x: target.x,
      y: target.y,
      z: target.z,
    });
  }

  /**
   * Play effect
   */
  playEffect(target, effectId) {
    console.log(
      `[ActionEffect] Play effect ${effectId} em ${target.x}, ${target.y}`,
    );
    this.emitEvent("playEffect", {
      effectId,
      x: target.x,
      y: target.y,
      z: target.z,
    });
  }

  /**
   * Play sound
   */
  playSound(target, soundId) {
    console.log(`[ActionEffect] Play sound ${soundId}`);
    this.emitEvent("playSound", {
      soundId,
      playerId: this.worldState.player?.id,
    });
  }

  /**
   * Emite evento customizado
   */
  emitCustomEvent(eventConfig, ctx) {
    const { eventName, eventData } = eventConfig;
    if (!eventName) return;

    const data =
      typeof eventData === "object" ? { ...eventData, ...ctx } : { ...ctx };

    this.emitEvent(eventName, data);
  }

  /**
   * Emite evento global
   */
  emitEvent(eventName, data) {
    // Event via window para outros sistemas ouvirem
    window.dispatchEvent(
      new CustomEvent(`action:${eventName}`, { detail: data }),
    );

    // Callbacks registrados
    const listeners = this.eventListeners.get(eventName) || [];
    for (const callback of listeners) {
      try {
        callback(data);
      } catch (error) {
        console.error(
          `[ActionConfigLoader] Erro no listener ${eventName}:`,
          error,
        );
      }
    }
  }

  /**
   * Registra listener para evento
   */
  on(eventName, callback) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName).push(callback);
  }

  /**
   * Remove listener
   */
  off(eventName, callback) {
    const listeners = this.eventListeners.get(eventName);
    if (!listeners) return;

    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * Mostra mensagem
   */
  showMessage(message, ctx) {
    const text =
      typeof message === "string"
        ? message
        : this.interpolateMessage(message, ctx);

    console.log(`[ActionMessage]`, text);

    // Dispatch para chat do RPG
    window.dispatchEvent(
      new CustomEvent("rpgChatMessage", {
        detail: { message: text, type: "action" },
      }),
    );
  }

  /**
   * Interpola variáveis na mensagem
   */
  interpolateMessage(message, ctx) {
    return message
      .replace(/{player\.name}/g, ctx.player?.name ?? "Herói")
      .replace(/{player\.x}/g, ctx.player?.x ?? 0)
      .replace(/{player\.y}/g, ctx.player?.y ?? 0)
      .replace(/{target\.x}/g, ctx.target?.x ?? 0)
      .replace(/{target\.y}/g, ctx.target?.y ?? 0)
      .replace(/{item\.name}/g, ctx.metadata?.name ?? "item");
  }

  /**
   * Lista ações registradas
   */
  listActions() {
    const actions = [];
    for (const [id, { config }] of this.registeredActions) {
      actions.push({
        id,
        type: config.type,
        spriteId: config.spriteId,
        position:
          config.type === "position"
            ? `${config.x},${config.y},${config.z}`
            : null,
        action: config.action,
      });
    }
    return actions;
  }

  /**
   * Remove ação registrada
   */
  unregisterAction(id) {
    const entry = this.registeredActions.get(id);
    if (!entry) return false;

    const { config } = entry;

    // Remove do actionSystem (não tem método direto, então apenas remove do map)
    this.registeredActions.delete(id);

    console.log(`[ActionConfigLoader] Ação '${id}' removida.`);
    return true;
  }

  /**
   * Limpa todas as ações
   */
  clearAll() {
    this.registeredActions.clear();
    this.eventListeners.clear();
    console.log("[ActionConfigLoader] Todas as ações limpas.");
  }
}

/**
 * Cria e inicializa ActionConfigLoader
 * @param {Object} worldState
 * @returns {ActionConfigLoader}
 */
export function createActionConfigLoader(worldState) {
  const loader = new ActionConfigLoader(worldState);

  // Registra listeners globais para eventos comuns
  loader.on("spawnCreature", (data) => {
    // Integrar com sistema de monstros
    console.log("[ActionEvent] Spawn:", data);
  });

  loader.on("actionDamage", (data) => {
    // Integrar com sistema de combate
    console.log("[ActionEvent] Dano:", data);
  });

  loader.on("actionHeal", (data) => {
    // Integrar com sistema de cura
    console.log("[ActionEvent] Cura:", data);
  });

  return loader;
}
