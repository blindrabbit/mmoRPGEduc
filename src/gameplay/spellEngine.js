// src/gameplay/spellEngine.js
import { SPELLS, SPELL_TYPE } from "./spellBook.js";
import { normalizeSpellAbility, ABILITY_KIND } from "./abilityCore.js";
import {
  executeAreaDamageOnMonsters,
  buildAreaEffectUpdates,
} from "./abilityEngine.js";
import {
  calculateSpellDamage,
  getAreaTiles,
  isTileWalkable,
} from "./combatLogic.js";
import {
  syncFieldEffect,
  removeFieldEffect,
  applyHpToPlayer,
  applyHpToMonster,
  syncEffect,
  batchWrite,
  PATHS,
} from "../core/db.js";
import { getMonsters } from "../core/worldStore.js";
import { worldEvents, EVENT_TYPES } from "../core/events.js";

export class SpellEngine {
  constructor({ player, getMonsters, getPlayers, map, mapData }) {
    this.player = player;
    this.getMonsters = getMonsters;
    this.getPlayers = getPlayers;
    this.map = map;
    this.mapData = mapData;
    this.activeFields = new Map(); // Para gerenciar campos ativos
  }

  /**
   * Tenta lançar uma magia - valida tudo antes de executar
   */
  async castSpell(spellId, targetParams = {}) {
    const spell = SPELLS[spellId];
    if (!spell) return { ok: false, reason: "Magia não encontrada" };

    // 1. Validações básicas
    const validations = this._validateCastRequirements(spell);
    if (!validations.ok) return validations;

    // 2. Consome mana e inicia cooldown (otimista, rollback se falhar)
    this._reserveResources(spell);

    try {
      // 3. Executa baseado no tipo da magia
      let result;
      switch (spell.type) {
        case SPELL_TYPE.DIRECT:
          result = await this._castTargetSpell(spell, targetParams);
          break;
        case SPELL_TYPE.AOE:
          if (spell.isField) {
            result = await this._castFieldSpell(spell, targetParams);
          } else {
            result = await this._castAreaSpell(spell, targetParams);
          }
          break;
        case SPELL_TYPE.SELF:
          result = await this._castSelfSpell(spell);
          break;
        case SPELL_TYPE.BUFF:
          // buff sem alvo vai para self, buff com range precisa de target
          if (spell.range) {
            result = await this._castTargetSpell(spell, targetParams);
          } else {
            result = await this._castSelfSpell(spell);
          }
          break;
        default:
          throw new Error(`Tipo de magia não implementado: ${spell.type}`);
      }

      // 4. Confirma consumo de recursos
      this._confirmResources(spell);

      // 5. Notifica UI/Logs
      return { ok: true, spellId, ...result };
    } catch (error) {
      // Rollback em caso de erro
      this._rollbackResources(spell);
      console.error(`[SpellEngine] Erro ao lançar ${spellId}:`, error);
      return { ok: false, reason: "Erro interno ao lançar magia" };
    }
  }

  _validateCastRequirements(spell) {
    const p = this.player;

    // Mana
    if ((p.stats.mp ?? 0) < spell.mpCost) {
      return { ok: false, reason: "Mana insuficiente" };
    }

    // Cooldown global da magia
    const lastCast = p.spells?.[spell.id]?.lastCast ?? 0;
    const now = Date.now();
    if (now - lastCast < spell.cooldownMs) {
      const remaining = Math.ceil((spell.cooldownMs - (now - lastCast)) / 1000);
      return { ok: false, reason: `Aguarde ${remaining}s` };
    }

    // Requisitos de nível/vocação
    if (spell.requirements) {
      if (p.stats.level < spell.requirements.level) {
        return {
          ok: false,
          reason: `Nível ${spell.requirements.level} necessário`,
        };
      }
      if (
        spell.requirements.vocation &&
        !spell.requirements.vocation.includes(p.appearance?.class)
      ) {
        return { ok: false, reason: "Vocação não pode usar esta magia" };
      }
    }

    return { ok: true };
  }

  async _castTargetSpell(spell, { targetId, direction }) {
    const monsters = this.getMonsters();
    const target = monsters[targetId];

    if (!target || (target.stats?.hp ?? 0) <= 0) {
      return { ok: false, reason: "Alvo inválido" };
    }

    // Valida distância e linha de visão (Tibia-style)
    const distance = this._calculateDistance(this.player, target);
    if (distance > spell.range) {
      return { ok: false, reason: "Alvo muito distante" };
    }

    if (!this._hasLineOfSight(this.player, target)) {
      return { ok: false, reason: "Sem linha de visão" };
    }

    // Calcula dano com fórmula da magia
    const damage = calculateSpellDamage(spell, this.player, target);

    // Animação do projétil (client-side preview)
    this._playMissileAnimation(this.player, target, spell.effect.animation);

    // Aplica dano após delay do projétil (ex: 300ms)
    setTimeout(() => {
      this._applyDamageToEntity(target, damage, spell.element);
    }, 300);

    // Atualiza último uso da magia
    this._recordSpellCast(spell.id);

    return { ok: true, damage, targetId };
  }

  async _castAreaSpell(spell, { centerTile, direction }) {
    // Determina tiles afetados baseado na forma da área
    const affectedTiles = getAreaTiles({
      caster: this.player,
      shape: spell.areaShape,
      size: spell.areaSize,
      direction: direction || this.player.direcao,
      map: this.map,
    });

    const results = [];
    const allEntities = { ...this.getMonsters(), ...this.getPlayers() };

    for (const tile of affectedTiles) {
      // Encontra entidades neste tile
      const entitiesHere = Object.values(allEntities).filter(
        (e) =>
          Math.round(e.x) === tile.x &&
          Math.round(e.y) === tile.y &&
          (e.z ?? 7) === (this.player.z ?? 7) &&
          (e.stats?.hp ?? 0) > 0,
      );

      for (const entity of entitiesHere) {
        // Pula o caster se friendlyFire = false
        if (!spell.friendlyFire && entity.id === this.player.id) continue;

        const damage = calculateSpellDamage(spell, this.player, entity, {
          isArea: true,
        });
        this._applyDamageToEntity(entity, damage, spell.element);
        results.push({ entityId: entity.id, damage });
      }
    }

    // Efeito visual da área (explosão, onda, etc.)
    this._playAreaEffect(affectedTiles, spell.effect.hitEffect);
    this._recordSpellCast(spell.id);

    return { ok: true, hits: results.length, details: results };
  }

  async _castFieldSpell(spell, { targetTile }) {
    // Valida se o tile é válido para colocar campo
    if (!this._isTileValidForField(targetTile)) {
      return { ok: false, reason: "Não é possível colocar campo aqui" };
    }

    // Verifica se já existe campo stackable neste tile
    if (!spell.fieldData.stackable) {
      const existingField = this._getFieldAtTile(targetTile);
      if (existingField) {
        return { ok: false, reason: "Já existe um campo aqui" };
      }
    }

    // Cria o campo no Firebase
    const fieldId = `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fieldData = {
      id: fieldId,
      spellId: spell.id,
      x: targetTile.x,
      y: targetTile.y,
      z: this.player.z ?? 7,
      createdAt: Date.now(),
      expiresAt: Date.now() + spell.fieldData.duration,
      damagePerTick: spell.fieldData.damagePerTick,
      tickInterval: spell.fieldData.tickInterval,
      ownerId: this.player.id,
      element: spell.element,
    };

    // Sync com servidor
    await syncFieldEffect(fieldId, fieldData);
    this.activeFields.set(fieldId, fieldData);

    // Inicia loop de dano do campo
    this._startFieldDamageLoop(fieldId, fieldData);

    // Efeito visual de criação
    this._playFieldSpawnEffect(targetTile, spell.fieldData.spriteId);
    this._recordSpellCast(spell.id);

    return { ok: true, fieldId, tile: targetTile };
  }

  _startFieldDamageLoop(fieldId, fieldData) {
    const tick = () => {
      const field = this.activeFields.get(fieldId);
      if (!field || Date.now() > field.expiresAt) {
        this._removeField(fieldId);
        return;
      }

      // Encontra entidades no tile do campo
      const entities = this._getEntitiesAtTile(field.x, field.y, field.z);
      for (const entity of entities) {
        if (entity.id === field.ownerId) continue; // Não dano ao dono (opcional)
        if ((entity.stats?.hp ?? 0) <= 0) continue;

        // Aplica dano por tick
        this._applyDamageToEntity(entity, field.damagePerTick, field.element, {
          isDot: true,
        });
      }

      // Próximo tick
      setTimeout(tick, field.tickInterval);
    };

    setTimeout(tick, fieldData.tickInterval);
  }

  _applyDamageToEntity(entity, damage, element, options = {}) {
    // Lógica de resistência elemental (Tibia-style)
    const resistance = entity.stats?.resistances?.[element] ?? 1.0;
    const finalDamage = Math.round(damage * resistance);

    // Aplica dano via Firebase (validação server-side)
    // Esta função deve existir em db.js
    // applyDamageToEntity(entity.id, finalDamage, { source: this.player.id, element });

    // Feedback visual imediato (client-side)
    if (finalDamage > 0) {
      // Floating text de dano
      // emitDamageText(entity.id, finalDamage, element);
    }
  }

  // Helpers de geometria e visão
  _calculateDistance(a, b) {
    return Math.max(
      Math.abs((a.x ?? 0) - (b.x ?? 0)),
      Math.abs((a.y ?? 0) - (b.y ?? 0)),
    );
  }

  _hasLineOfSight(caster, target) {
    // Implementa raycasting simples estilo Tibia
    // Verifica se há tiles com "blocking: projectile: false" no caminho
    return true; // TODO: Implementar raycasting completo
  }

  _isTileValidForField(tile) {
    // Verifica se o tile é walkable e não tem obstáculo
    const tileKey = `${tile.x}_${tile.y}`;
    const tileData = this.mapData?.[tileKey];
    return tileData?.is_walkable !== false;
  }

  _getFieldAtTile(tile) {
    // Busca campo ativo neste tile
    for (const field of this.activeFields.values()) {
      if (
        field.x === tile.x &&
        field.y === tile.y &&
        field.z === (this.player.z ?? 7)
      ) {
        return field;
      }
    }
    return null;
  }

  _getEntitiesAtTile(x, y, z) {
    const all = { ...this.getMonsters(), ...this.getPlayers() };
    return Object.values(all).filter(
      (e) =>
        Math.round(e.x) === x &&
        Math.round(e.y) === y &&
        (e.z ?? 7) === z &&
        (e.stats?.hp ?? 0) > 0,
    );
  }

  _recordSpellCast(spellId) {
    // Atualiza último uso no player (será syncado via watchPlayerData)
    if (!this.player.spells) this.player.spells = {};
    this.player.spells[spellId] = { lastCast: Date.now() };
  }

  _reserveResources(spell) {
    /* ... */
  }
  _confirmResources(spell) {
    /* ... */
  }
  _rollbackResources(spell) {
    /* ... */
  }
  _playMissileAnimation(from, to, animId) {
    /* ... */
  }
  _playAreaEffect(tiles, effectId) {
    /* ... */
  }
  _playFieldSpawnEffect(tile, spriteId) {
    /* ... */
  }
  _removeField(fieldId) {
    /* ... */
  }
}

// =============================================================================
// API FUNCIONAL — usada por spellHUD.js (sem instanciar SpellEngine)
// =============================================================================

/** Registro de cooldowns: Map<"playerId:spellId", expiry timestamp> */
const _cooldownRegistry = new Map();

/**
 * Verifica se uma magia está em cooldown para um player.
 * @param {string} playerId
 * @param {string} spellId
 * @returns {boolean}
 */
export function isSpellOnCooldown(playerId, spellId) {
  const key = `${playerId}:${spellId}`;
  const expiry = _cooldownRegistry.get(key);
  if (!expiry) return false;
  if (Date.now() >= expiry) {
    _cooldownRegistry.delete(key);
    return false;
  }
  return true;
}

/**
 * Retorna o tempo restante de cooldown em ms (0 se não estiver em cooldown).
 * @param {string} playerId
 * @param {string} spellId
 * @returns {number}
 */
export function getSpellCooldownRemaining(playerId, spellId) {
  const key = `${playerId}:${spellId}`;
  const expiry = _cooldownRegistry.get(key);
  if (!expiry) return 0;
  const rem = expiry - Date.now();
  return rem > 0 ? rem : 0;
}

/**
 * Lança uma magia via API funcional (sem instância de SpellEngine).
 * Usada pelo spellHUD.js.
 *
 * @param {Object} opts
 * @param {Object}  opts.player       - Entidade do jogador (stats, x, y, z, spells)
 * @param {string}  opts.playerId     - ID do jogador
 * @param {string}  opts.spellId      - ID da magia
 * @param {Object|null} opts.target   - Entidade alvo (ou null para self/área)
 * @param {Function} [opts.getGameTime] - () => number (timestamp do servidor)
 * @returns {Promise<{ok: boolean, reason?: string, damage?: number}>}
 */
/**
 * Grava um efeito visual de magia no Firebase world_effects.
 * @param {number|null} effectId  - ID do sprite de animação (effects_data.json)
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} duration - ms
 * @param {string} tag - prefixo do ID único
 * @param {number} now
 */
function _syncSpellEffect(effectId, x, y, z, duration, tag, now) {
  if (effectId == null) return;
  const id = `${tag}_${now}_${Math.random().toString(36).slice(2, 7)}`;
  syncEffect(id, {
    id,
    type: "effect",
    effectId: Number(effectId),
    x: Number(x),
    y: Number(y),
    z: Number(z ?? 7),
    startTime: Number(now),
    effectDuration: Number(duration),
    expiry: Number(now + duration),
    isField: false,
  }).catch(() => {}); // fire-and-forget
}

export async function castSpell({
  player,
  playerId,
  spellId,
  target,
  getGameTime,
}) {
  const spell = SPELLS?.[spellId];
  if (!spell) return { ok: false, reason: "Magia não encontrada" };
  const ability = normalizeSpellAbility(spell);
  if (!ability) return { ok: false, reason: "Magia inválida" };

  // Verifica cooldown
  if (isSpellOnCooldown(playerId, spellId)) {
    const rem = Math.ceil(getSpellCooldownRemaining(playerId, spellId) / 1000);
    return { ok: false, reason: `Cooldown: ${rem}s` };
  }

  // Verifica MP
  const currentMp = player?.stats?.mp ?? 0;
  if (currentMp < ability.cost.mp) {
    return { ok: false, reason: "Mana insuficiente" };
  }

  // Registra cooldown
  const now = typeof getGameTime === "function" ? getGameTime() : Date.now();
  _cooldownRegistry.set(
    `${playerId}:${spellId}`,
    now + (ability.cooldownMs ?? 1000),
  );

  // Efeito visual no caster (selfEffectId)
  if (ability.visuals.selfEffectId != null) {
    _syncSpellEffect(
      ability.visuals.selfEffectId,
      player?.x,
      player?.y,
      player?.z,
      ability.visuals.effectDuration ?? 700,
      `spell_self_${spellId}`,
      now,
    );
  }

  // Emite evento de lançamento (HUD / log)
  worldEvents.emit(EVENT_TYPES.SPELL_CAST, {
    casterId: playerId,
    spellId,
    spellType: ability.kind,
    casterX: player?.x,
    casterY: player?.y,
    casterZ: player?.z ?? 7,
    targetId: target?.id ?? null,
    targetX: target?.x ?? null,
    targetY: target?.y ?? null,
    targetZ: target?.z ?? 7,
    effectId: ability.visuals.selfEffectId ?? null,
    effectDuration: ability.visuals.effectDuration ?? 700,
  });

  let damage = 0;
  let heal = 0;

  // ── DANO em alvo único (DIRECT) ───────────────────────────────────────────
  if (ability.kind === ABILITY_KIND.DIRECT && target && spell.damage) {
    damage = calculateSpellDamage(spell, player, target);
    const newHp = Math.max(0, (target.stats?.hp ?? 0) - damage);

    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      attackerId: playerId,
      defenderId: target.id,
      defenderType: "monsters",
      damage,
      isCritical: false,
      spellId,
      defenderX: target.x,
      defenderY: target.y,
      defenderZ: target.z ?? 7,
    });

    // Efeito visual no alvo (gravado no Firebase para o renderer)
    if (ability.visuals.effectId != null) {
      _syncSpellEffect(
        ability.visuals.effectId,
        target.x,
        target.y,
        target.z,
        ability.visuals.effectDuration ?? 700,
        `spell_hit_${spellId}`,
        now,
      );
    }

    if (newHp <= 0) {
      worldEvents.emit(EVENT_TYPES.COMBAT_KILL, {
        attackerId: playerId,
        victimId: target.id,
        victimType: "monsters",
        victimX: target.x,
        victimY: target.y,
        victimZ: target.z ?? 7,
      });
    }

    await applyHpToMonster(target.id, newHp);
  }

  // ── CURA SELF ─────────────────────────────────────────────────────────────
  if (ability.kind === ABILITY_KIND.SELF && spell.heal) {
    const base = spell.heal.base ?? 0;
    const variance = spell.heal.variance ?? 0;
    heal = Math.max(
      1,
      Math.round(base * (1 - variance + Math.random() * variance * 2)),
    );
    const maxHp = player?.stats?.maxHp ?? 100;
    const newHp = Math.min(maxHp, (player?.stats?.hp ?? 0) + heal);

    worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, {
      defenderId: playerId,
      defenderType: "players",
      damage: -heal,
      isHeal: true,
      spellId,
      defenderX: player?.x,
      defenderY: player?.y,
      defenderZ: player?.z ?? 7,
    });

    // Efeito visual de cura (selfEffectId já foi gravado acima — não duplica)

    await applyHpToPlayer(playerId, newHp);
  }

  // ── AOE ───────────────────────────────────────────────────────────────────
  if (ability.kind === ABILITY_KIND.AOE && spell.damage) {
    const monsters = getMonsters?.() ?? {};
    const casterX = Math.round(player?.x ?? 0);
    const casterY = Math.round(player?.y ?? 0);
    const casterZ = player?.z ?? 7;
    const radius = Number(ability.aoeRadius ?? 2);
    const hitResults = await executeAreaDamageOnMonsters({
      caster: player,
      casterId: playerId,
      abilityId: spellId,
      radius,
      monsters,
      calcDamage: (mob) =>
        calculateSpellDamage(spell, player, mob, { isArea: true }),
      applyHp: applyHpToMonster,
      emitDamage: (payload) => {
        worldEvents.emit(EVENT_TYPES.COMBAT_DAMAGE, { ...payload, spellId });
      },
      emitKill: (payload) => {
        worldEvents.emit(EVENT_TYPES.COMBAT_KILL, payload);
      },
    });

    // Efeito visual em todos os tiles da área (não apenas no caster)
    if (ability.visuals.effectId != null) {
      const fxBasePath = ability.visuals.isField ? PATHS.fields : PATHS.effects;
      const fxUpdates = buildAreaEffectUpdates({
        effectId: ability.visuals.effectId,
        casterX,
        casterY,
        casterZ,
        radius,
        now,
        idPrefix: `spell_${spellId}_${playerId}`,
        isField: ability.visuals.isField,
        fieldDuration: ability.visuals.fieldDuration,
        effectDuration: ability.visuals.effectDuration,
        basePath: fxBasePath,
      });

      if (Object.keys(fxUpdates).length > 0) {
        await batchWrite(fxUpdates);
      }
    }

    damage = hitResults.reduce((sum, hit) => sum + hit.damage, 0);
  }

  return { ok: true, spellId, damage, heal };
}
