import { COMBAT_TICK_MS } from "./combatScheduler.js";

/**
 * Converte delta (dx, dy) em string de direção canônica.
 * @param {number} dx
 * @param {number} dy
 * @returns {string} 'frente' | 'costas' | 'lado' | 'lado-esquerdo'
 */
export function getDirectionFromDelta(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "lado" : "lado-esquerdo";
  }
  return dy >= 0 ? "frente" : "costas";
}

export const COMBAT = {
  // Cooldowns base (ms)
  MELEE_ATTACK_INTERVAL: COMBAT_TICK_MS,
  DISTANCE_ATTACK_INTERVAL: COMBAT_TICK_MS,
  ATTACK_COOLDOWN_MS: COMBAT_TICK_MS,

  // Distâncias
  MELEE_RANGE: 1,
  MAX_DISTANCE_RANGE: 5,

  // Fórmulas de dano
  DAMAGE_FORMULA: {
    melee: (atk, def) => {
      // Dano base com variação de 0-20%
      const base = Math.max(0, atk - def * 0.5);
      const variance = 0.2;
      return Math.round(base * (1 - variance + Math.random() * variance * 2));
    },
    distance: (atk, def, distance) => {
      // Dano reduz com distância (Tibia-style)
      const distancePenalty = Math.max(0.7, 1 - (distance - 1) * 0.08);
      const base = Math.max(0, atk * distancePenalty - def * 0.4);
      return Math.round(base * (0.9 + Math.random() * 0.2));
    },
  },

  // Chance de acerto
  HIT_CHANCE_FORMULA: (attackerHit, defenderDefense, distance = 1) => {
    const distancePenalty = distance > 1 ? (distance - 1) * 5 : 0;
    const baseChance = attackerHit - defenderDefense * 0.3 - distancePenalty;
    return Math.max(10, Math.min(95, baseChance)); // Clamp entre 10-95%
  },

  // Skill gain (progressão)
  SKILL_GAIN: {
    sword: { attacksPerGain: 30, baseChance: 0.08 },
    distance: { attacksPerGain: 30, baseChance: 0.08 },
    shielding: { blocksPerGain: 40, baseChance: 0.06 },
  },
};

/**
 * Calcula resultado de um ataque físico
 */
export function calculatePhysicalAttack(
  attacker,
  defender,
  weapon,
  options = {},
) {
  const { isMelee = true, distance = 1 } = options;

  // 1. Valida alcance
  const maxRange = isMelee ? COMBAT.MELEE_RANGE : COMBAT.MAX_DISTANCE_RANGE;
  if (distance > maxRange) {
    return { hit: false, reason: "fora_de_alcance" };
  }

  // 2. Chance de acerto
  const atkSkill = attacker.stats?.[isMelee ? "sword" : "distance"] ?? 0;
  const defSkill = defender.stats?.shielding ?? 0;
  const hitChance = COMBAT.HIT_CHANCE_FORMULA(
    weapon.hitChance + atkSkill * 0.5,
    defSkill * 0.8,
    distance,
  );

  if (Math.random() * 100 > hitChance) {
    return { hit: false, reason: "miss", hitChance };
  }

  // 3. Chance de bloqueio pelo escudo
  const shield = defender.equipment?.shield;
  if (shield && WEAPON_DEFINITIONS[shield]) {
    const blockChance = WEAPON_DEFINITIONS[shield].blockChance + defSkill * 0.3;
    if (Math.random() * 100 < blockChance) {
      return { hit: false, reason: "blocked", blockChance };
    }
  }

  // 4. Calcula dano
  const atkValue = weapon.attack + atkSkill * 0.8;
  const defValue = defender.stats?.def ?? 0;
  const damageFormula = isMelee
    ? COMBAT.DAMAGE_FORMULA.melee
    : COMBAT.DAMAGE_FORMULA.distance;
  const baseDamage = damageFormula(atkValue, defValue, distance);

  // 5. Aplica resistência elemental se houver
  const element = weapon.element;
  const resistance = defender.stats?.resistances?.[element] ?? 1.0;
  const finalDamage = Math.round(baseDamage * resistance);

  // 6. Chance de critical (baseado em skill alta)
  let isCritical = false;
  if (atkSkill > 50 && Math.random() < 0.05) {
    isCritical = true;
    return {
      hit: true,
      damage: Math.round(finalDamage * 1.5),
      critical: true,
      hitChance,
    };
  }

  return { hit: true, damage: Math.max(1, finalDamage), hitChance };
}

// =============================================================================
// FUNÇÕES DE COMPAT — usadas por combatEngine.js e combatService.js
// =============================================================================

/**
 * Calcula resultado de combate simples entre dois conjuntos de stats.
 * Compat com chamadas legadas que não possuem weapon object.
 *
 * @param {Object} atkStats - Stats do atacante (atk, sword/distance, hit)
 * @param {Object} defStats - Stats do defensor (def, shielding, hp, maxHp)
 * @returns {{ hit: boolean, damage: number, critical: boolean }}
 */
export function calculateCombatResult(atkStats, defStats) {
  const atkValue =
    (atkStats?.atk ?? 0) + (atkStats?.sword ?? atkStats?.distance ?? 0) * 0.8;
  const defValue = defStats?.def ?? 0;
  const defSkill = defStats?.shielding ?? 0;
  const hitChance = COMBAT.HIT_CHANCE_FORMULA(
    (atkStats?.hit ?? 50) + (atkStats?.sword ?? 0) * 0.5,
    defSkill * 0.8,
    1,
  );

  if (Math.random() * 100 > hitChance) {
    return { hit: false, damage: 0, critical: false };
  }

  const baseDamage = COMBAT.DAMAGE_FORMULA.melee(atkValue, defValue);
  const atkSkill = atkStats?.sword ?? atkStats?.distance ?? 0;

  if (atkSkill > 50 && Math.random() < 0.05) {
    return { hit: true, damage: Math.round(baseDamage * 1.5), critical: true };
  }

  return { hit: true, damage: Math.max(1, baseDamage), critical: false };
}

/**
 * Calcula novo HP após delta (positivo = cura, negativo = dano).
 * @param {number} currentHp
 * @param {number} delta - Negativo para dano, positivo para cura
 * @param {number} [maxHp=currentHp]
 * @returns {number}
 */
export function calculateNewHp(currentHp, delta, maxHp = currentHp) {
  return Math.max(0, Math.min(maxHp, (currentHp ?? 0) + delta));
}

/**
 * Aplica modificadores finais ao dano (ex: critico já resolvido antes, retorna base).
 * @param {number} baseDamage
 * @param {Object} result - Resultado de calculateCombatResult
 * @returns {number}
 */
export function calculateFinalDamage(baseDamage, result) {
  // Crítico já está incorporado em result.damage; retorna como-está.
  return Math.max(0, baseDamage);
}

// =============================================================================
// FUNÇÕES DE MAGIA — usadas por spellEngine.js
// =============================================================================

/**
 * Calcula dano de uma magia considerando stats do caster e resistências do alvo.
 *
 * @param {Object} spell   - Definição da magia (damage, element, etc.)
 * @param {Object} caster  - Entidade atacante com stats
 * @param {Object} target  - Entidade alvo com stats e resistances
 * @param {Object} [options]
 * @param {boolean} [options.isArea=false] - Magia de área sofre penalidade
 * @returns {number} Dano final (inteiro >= 0)
 */
export function calculateSpellDamage(spell, caster, target, options = {}) {
  const damageCfg = spell?.damage;
  const baseDamage =
    typeof damageCfg === "number" ? damageCfg : Number(damageCfg?.base ?? 0);
  const configuredVariance =
    typeof damageCfg === "number"
      ? 0.1
      : Number.isFinite(Number(damageCfg?.variance))
        ? Number(damageCfg.variance)
        : 0.1;
  const magicLevel = caster.stats?.ml ?? caster.stats?.magic ?? 0;

  // Bônus de magic level (Tibia-style: ~cada nível acrescenta fator)
  const mlBonus = 1 + magicLevel * 0.04;

  // Variação aleatória configurável (default 10%)
  const spread = Math.max(0, configuredVariance);
  const variance = 1 - spread + Math.random() * spread * 2;

  let damage = Math.round(baseDamage * mlBonus * variance);

  // Penalidade de 30% para magias de área
  if (options.isArea) damage = Math.round(damage * 0.7);

  // Resistência elemental do alvo
  const element = spell.element ?? null;
  const resistance = element
    ? (target.stats?.resistances?.[element] ?? 1.0)
    : 1.0;
  damage = Math.round(damage * resistance);

  return Math.max(0, damage);
}

/**
 * Retorna lista de tiles afetados por uma área de magia.
 *
 * @param {Object} opts
 * @param {Object}  opts.caster    - Entidade que lança (com x, y, z)
 * @param {string}  opts.shape     - 'cross' | 'square' | 'line' | 'cone'
 * @param {number}  opts.size      - Raio / comprimento da área
 * @param {string}  [opts.direction] - 'n'|'s'|'e'|'w' (para line/cone)
 * @param {*}       [opts.map]     - Referência ao mapa (reservado para uso futuro)
 * @returns {Array<{x: number, y: number}>}
 */
export function getAreaTiles({ caster, shape = "cross", size = 1, direction }) {
  const cx = Math.round(caster.x ?? 0);
  const cy = Math.round(caster.y ?? 0);
  const tiles = [];

  if (shape === "cross") {
    for (let d = 1; d <= size; d++) {
      tiles.push({ x: cx, y: cy - d }); // norte
      tiles.push({ x: cx, y: cy + d }); // sul
      tiles.push({ x: cx - d, y: cy }); // oeste
      tiles.push({ x: cx + d, y: cy }); // leste
    }
    tiles.push({ x: cx, y: cy }); // centro
  } else if (shape === "square") {
    for (let dx = -size; dx <= size; dx++) {
      for (let dy = -size; dy <= size; dy++) {
        tiles.push({ x: cx + dx, y: cy + dy });
      }
    }
  } else if (shape === "line") {
    const dirs = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    const [ddx, ddy] = dirs[direction] ?? dirs.s;
    for (let i = 1; i <= size; i++) {
      tiles.push({ x: cx + ddx * i, y: cy + ddy * i });
    }
  } else if (shape === "cone") {
    const dirs = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    const [ddx, ddy] = dirs[direction] ?? dirs.s;
    for (let i = 1; i <= size; i++) {
      tiles.push({ x: cx + ddx * i, y: cy + ddy * i });
      // Alarga o cone a cada nível de distância
      for (let perp = 1; perp < i; perp++) {
        tiles.push({
          x: cx + ddx * i + ddy * perp,
          y: cy + ddy * i + ddx * perp,
        });
        tiles.push({
          x: cx + ddx * i - ddy * perp,
          y: cy + ddy * i - ddx * perp,
        });
      }
    }
  }

  return tiles;
}

/**
 * Verifica se um tile é walkable consultando mapData.
 *
 * @param {{ x: number, y: number }} tile
 * @param {Object} mapData - Mapa indexado por "x_y"
 * @returns {boolean}
 */
export function isTileWalkable(tile, mapData) {
  if (!mapData) return true;
  const key = `${Math.round(tile.x)}_${Math.round(tile.y)}`;
  return mapData[key]?.is_walkable !== false;
}

/**
 * Verifica se atacante está em alcance para atacar alvo
 */
export function isInAttackRange(attacker, target, weaponRange = 1) {
  const dx = Math.abs((attacker.x ?? 0) - (target.x ?? 0));
  const dy = Math.abs((attacker.y ?? 0) - (target.y ?? 0));
  const dz = Math.abs((attacker.z ?? 7) - (target.z ?? 7));

  // Deve estar no mesmo andar para combate físico
  if (dz > 0) return false;

  // Distância de Chebyshev (Tibia usa 8-directional)
  const distance = Math.max(dx, dy);
  return distance <= weaponRange;
}
