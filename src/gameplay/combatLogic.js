// =============================================================================
// combatLogic.js — mmoRPGGame
// Camada 3: Cálculos puros de combate.
// REGRA: ZERO imports de Firebase, worldStore ou DOM.
//        Todas as funções recebem dados como parâmetro e retornam valores.
//        Podem ser testadas isoladamente sem nenhuma dependência externa.
// Dependências: NENHUMA
// =============================================================================

// ---------------------------------------------------------------------------
// CONSTANTES DE COMBATE
// Centralizadas aqui para fácil ajuste de balanceamento sem tocar em lógica.
// ---------------------------------------------------------------------------
export const COMBAT = {
  BASE_HIT_CHANCE: 0.8, // chance base de acertar (80%)
  MIN_HIT_CHANCE: 0.1, // piso global de acerto (10%)
  MAX_HIT_CHANCE: 0.98, // teto global de acerto (98%)
  AGI_HIT_FACTOR: 0.003, // cada ponto de agi do atacante +0.3% de acerto
  AGI_DODGE_FACTOR: 0.0025, // cada ponto de agi do defensor -0.25% de acerto
  LEVEL_HIT_FACTOR: 0.02, // diferença de level (atk-def) altera hit em 2% por nível
  LEVEL_HIT_CAP: 0.35, // limite de impacto do level na chance de acerto
  LEVEL_DMG_FACTOR: 0.015, // level aumenta dano base em 1.5% por nível acima de 1
  LEVEL_DMG_CAP: 0.6, // bônus máximo de dano por level (60%)
  DEF_REDUCTION_CAP: 0.75, // redução máxima de dano por defesa (75%)
  MIN_DAMAGE: 1, // dano mínimo garantido por acerto
  ATTACK_COOLDOWN_MS: 2000, // cooldown padrão de ataque do player (ms)
  DEFAULT_AI_INTERVAL: 300, // intervalo mínimo de decisão de IA por monstro (ms)
};

// ---------------------------------------------------------------------------
// calculateCombatResult
// Determina se um ataque acerta e quanto de dano causa.
// Usado por: rpg.html (ataque do player), monsterManager (ataque de monstro)
//
// @param {object} atkStats  - stats do atacante { atk, agi }
// @param {object} defStats  - stats do defensor { def, agi }
// @returns {{ hit: boolean, damage: number }}
// ---------------------------------------------------------------------------
export function calculateCombatResult(atkStats, defStats) {
  const atk = Number(atkStats?.atk ?? 10);
  const def = Number(defStats?.def ?? 5);
  const atkAgi = Number(atkStats?.agi ?? 10);
  const defAgi = Number(defStats?.agi ?? 10);
  const atkLevel = Math.max(1, Number(atkStats?.level ?? 1));
  const defLevel = Math.max(1, Number(defStats?.level ?? 1));
  const levelDelta = atkLevel - defLevel;

  const levelHitBonus = Math.max(
    -COMBAT.LEVEL_HIT_CAP,
    Math.min(COMBAT.LEVEL_HIT_CAP, levelDelta * COMBAT.LEVEL_HIT_FACTOR),
  );

  // Chance de acerto: base + bônus de agilidade do atacante - esquiva do defensor
  const hitChance = Math.min(
    COMBAT.MAX_HIT_CHANCE,
    Math.max(
      COMBAT.MIN_HIT_CHANCE,
      COMBAT.BASE_HIT_CHANCE +
        atkAgi * COMBAT.AGI_HIT_FACTOR -
        defAgi * COMBAT.AGI_DODGE_FACTOR +
        levelHitBonus,
    ),
  );

  const hit = Math.random() < hitChance;
  if (!hit) {
    return {
      hit: false,
      damage: 0,
      hitChance,
      levelDelta,
      levelDamageMultiplier: 1,
    };
  }

  const levelDamageMultiplier =
    1 +
    Math.max(
      0,
      Math.min(COMBAT.LEVEL_DMG_CAP, (atkLevel - 1) * COMBAT.LEVEL_DMG_FACTOR),
    );

  const effectiveAtk = atk * levelDamageMultiplier;
  const effectiveDef = Math.max(0, def) * (1 + (defLevel - 1) * 0.005);

  // Redução por defesa: proporcional, com cap máximo
  const defReduction = Math.min(
    COMBAT.DEF_REDUCTION_CAP,
    effectiveDef / (effectiveDef + effectiveAtk),
  );

  const variance = 0.9 + Math.random() * 0.2;
  const rawDamage = effectiveAtk * (1 - defReduction) * variance;
  const damage = Math.max(COMBAT.MIN_DAMAGE, Math.round(rawDamage));

  return {
    hit: true,
    damage,
    hitChance,
    levelDelta,
    levelDamageMultiplier,
  };
}

// ---------------------------------------------------------------------------
// calculateStepDuration
// Retorna o tempo em ms que uma entidade leva para se mover 1 tile.
// Usado por: monsterManager (IA de movimento), input.js (player)
//
// @param {number} speed - velocidade da entidade (pixels/s equivalente)
// @returns {number} duração em ms por tile
// ---------------------------------------------------------------------------
export function calculateStepDuration(speed = 120) {
  const s = Math.max(1, Number(speed));
  // Fórmula: quanto maior o speed, menor o tempo de passo
  // speed=120 → ~267ms | speed=80 → ~400ms | speed=200 → ~160ms
  return Math.round(32000 / s);
}

// ---------------------------------------------------------------------------
// calculateFinalDamage
// Aplica modificador base de um ataque específico ao resultado de combate.
// Usado por: monsterManager (ataques com dano base definido no template)
//
// @param {number} baseDamage   - dano base do ataque (do template)
// @param {object} combatResult - resultado de calculateCombatResult
// @returns {number} dano final
// ---------------------------------------------------------------------------
export function calculateFinalDamage(baseDamage, combatResult) {
  if (!combatResult.hit) return 0;
  const levelMultiplier = Math.max(
    1,
    Number(combatResult?.levelDamageMultiplier ?? 1),
  );
  const scaledBase = Number(baseDamage ?? 0) * levelMultiplier;
  // O baseDamage do ataque soma ao dano calculado por stats
  return Math.max(
    COMBAT.MIN_DAMAGE,
    Math.round(scaledBase + Number(combatResult.damage ?? 0)),
  );
}

// ---------------------------------------------------------------------------
// calculateNewHp
// Aplica dano/cura a um HP atual, garantindo limites 0..maxHp.
// Usado por: combatService, monsterManager
//
// @param {number} currentHp
// @param {number} delta     - positivo = cura, negativo = dano
// @param {number} maxHp
// @returns {number} novo HP já limitado
// ---------------------------------------------------------------------------
export function calculateNewHp(currentHp, delta, maxHp = Infinity) {
  return Math.min(maxHp, Math.max(0, Number(currentHp) + Number(delta)));
}

// ---------------------------------------------------------------------------
// isInAttackRange
// Verifica se um alvo está dentro do alcance de um ataque.
//
// @param {{ x, y }} attacker
// @param {{ x, y }} target
// @param {number}   range    - alcance em tiles
// @returns {boolean}
// ---------------------------------------------------------------------------
export function isInAttackRange(attacker, target, range = 1) {
  const dist = Math.hypot(target.x - attacker.x, target.y - attacker.y);
  return dist <= range + 0.5; // +0.5 de tolerância diagonal
}

// ---------------------------------------------------------------------------
// getDirectionFromDelta
// Converte um delta (dx, dy) para a string de direção canônica.
// Usado por: monsterAI, playerLogic (ao mover)
//
// @param {number} dx
// @param {number} dy
// @returns {string} 'frente' | 'costas' | 'lado' | 'lado-esquerdo'
// ---------------------------------------------------------------------------
export function getDirectionFromDelta(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "lado" : "lado-esquerdo";
  }
  return dy > 0 ? "frente" : "costas";
}
