import { COMBAT_TICK_MS } from "./combatScheduler.js";
import { EQUIPMENT_DATA } from "../core/equipmentData.js";

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
 * Determina o combatProfile do atacante com base no weaponType equipado.
 * Usado internamente para selecionar o atributo primário de ataque.
 * @param {string|null} weaponType
 * @returns {'melee'|'distance'|'caster'}
 */
function _profileFromWeaponType(weaponType) {
  if (weaponType === "wand" || weaponType === "rod" || weaponType === "spellbook") return "caster";
  if (weaponType === "distance") return "distance";
  return "melee";
}

/**
 * Calcula resultado de um ataque físico.
 * Usa atributos FOR/AGI/INT/VIT — sem skills.
 *
 * @param {Object} attacker  - Entidade atacante (com stats.FOR, AGI, INT, VIT)
 * @param {Object} defender  - Entidade defensora (com stats.VIT, equipment)
 * @param {Object} weapon    - { id, attack, defense, element } ou entrada de EQUIPMENT_DATA
 * @param {Object} [options]
 * @param {number} [options.distance=1]
 * @returns {{ hit: boolean, damage?: number, critical?: boolean, reason?: string,
 *             weaponType?: string, shootType?: string }}
 */
export function calculatePhysicalAttack(
  attacker,
  defender,
  weapon,
  options = {},
) {
  const { distance = 1 } = options;

  // Resolve dados do equipamento
  const equipData = EQUIPMENT_DATA[Number(weapon?.id)] ?? weapon ?? {};
  const weaponType = equipData.weaponType ?? null;
  const shootType  = equipData.shootType  ?? null;
  const profile    = equipData.combatProfile ?? _profileFromWeaponType(weaponType);

  // 1. Valida alcance
  const maxRange = profile === "melee" ? COMBAT.MELEE_RANGE : (equipData.range ?? COMBAT.MAX_DISTANCE_RANGE);
  if (distance > maxRange) {
    return { hit: false, reason: "fora_de_alcance", weaponType, shootType };
  }

  // 2. Atributo primário de ataque (sem skills)
  const atkStats = attacker.stats ?? {};
  let atkAttr;
  if (profile === "caster")   atkAttr = atkStats.INT ?? atkStats.int ?? 0;
  else if (profile === "distance") atkAttr = atkStats.AGI ?? atkStats.agi ?? 0;
  else                        atkAttr = atkStats.FOR ?? atkStats.for ?? 0;

  // 3. Atributo de defesa do defensor (VIT)
  const defVIT = defender.stats?.VIT ?? defender.stats?.vit ?? 0;

  // 4. Chance de acerto
  const hitChance = COMBAT.HIT_CHANCE_FORMULA(
    (weapon.hitChance ?? 50) + atkAttr * 0.6,
    defVIT * 0.5,
    distance,
  );
  if (Math.random() * 100 > hitChance) {
    return { hit: false, reason: "miss", hitChance, weaponType, shootType };
  }

  // 5. Chance de bloqueio pelo escudo (defense do escudo + VIT do defensor)
  const shieldId = defender.equipment?.LEFT ?? defender.equipment?.shield;
  const shieldData = shieldId ? EQUIPMENT_DATA[Number(shieldId)] : null;
  if (shieldData?.weaponType === "shield") {
    const blockChance = (shieldData.defense ?? 0) * 0.5 + defVIT * 0.3;
    if (Math.random() * 100 < blockChance) {
      return { hit: false, reason: "blocked", blockChance, weaponType, shootType };
    }
  }

  // 6. Calcula dano base
  const atkValue = (equipData.attack ?? weapon.attack ?? 0) + atkAttr * 0.8;
  const defValue = defender.stats?.def ?? defender.stats?.VIT * 0.4 ?? 0;
  const damageFormula = profile === "melee"
    ? COMBAT.DAMAGE_FORMULA.melee
    : COMBAT.DAMAGE_FORMULA.distance;
  const baseDamage = damageFormula(atkValue, defValue, distance);

  // 7. Resistência elemental (wands têm wandType/element)
  const element = equipData.wandType ?? equipData.element ?? weapon.element ?? null;
  const resistance = element
    ? (defender.stats?.resistances?.[element] ?? 1.0)
    : 1.0;
  const finalDamage = Math.round(baseDamage * resistance);

  // 8. Critical — baseado em AGI (atributo universal de chance crítica)
  const agi = atkStats.AGI ?? atkStats.agi ?? 0;
  const critChance = Math.min(0.25, agi * 0.006); // 0.6% por ponto de AGI, cap 25%
  if (Math.random() < critChance) {
    return {
      hit: true,
      damage: Math.round(finalDamage * 1.5),
      critical: true,
      hitChance,
      weaponType,
      shootType,
    };
  }

  return { hit: true, damage: Math.max(1, finalDamage), critical: false, hitChance, weaponType, shootType };
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
  const attackerAgi = atkStats?.agility ?? atkStats?.agi ?? atkStats?.AGI ?? 0;
  const defenderAgi = defStats?.agility ?? defStats?.agi ?? defStats?.AGI ?? 0;
  const atkValue =
    (atkStats?.attackPower ?? atkStats?.atk ?? 0) +
    (atkStats?.sword ?? atkStats?.distance ?? 0) * 0.8;
  const defValue = defStats?.defense ?? defStats?.def ?? 0;
  const defSkill = defStats?.shielding ?? 0;
  const hitChance = COMBAT.HIT_CHANCE_FORMULA(
    (atkStats?.hit ?? 50) + attackerAgi * 1.2 + (atkStats?.sword ?? 0) * 0.5,
    defSkill * 0.8 + defValue * 0.4 + defenderAgi * 0.8,
    1,
  );

  if (Math.random() * 100 > hitChance) {
    return { hit: false, damage: 0, critical: false };
  }

  const baseDamage = COMBAT.DAMAGE_FORMULA.melee(atkValue, defValue);
  const atkSkill = atkStats?.sword ?? atkStats?.distance ?? 0;
  const critChance = atkStats?.critChance ?? (attackerAgi > 50 ? 0.05 : 0);

  if ((atkSkill > 50 || critChance > 0) && Math.random() < critChance) {
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
