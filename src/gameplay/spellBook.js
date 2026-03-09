// =============================================================================
// spellBook.js — mmoRPGGame
// Camada 3: Catálogo canônico de todas as magias do jogo.
// REGRA: ZERO imports de Firebase, worldStore ou DOM.
//        Dados puros — cada magia é um objeto de configuração.
//        Adicionar nova magia = adicionar entrada no SPELLS ou SPELL_SETS.
// Dependências: NENHUMA
// =============================================================================

// ---------------------------------------------------------------------------
// TIPOS DE MAGIA
// Usados para determinar comportamento no spellEngine.js
// ---------------------------------------------------------------------------
export const SPELL_TYPE = {
  DIRECT: "direct", // dano direto num alvo único (requer targetLock)
  SELF: "self", // efeito no próprio jogador (heal, buff)
  AOE: "aoe", // área de efeito ao redor do jogador
  BUFF: "buff", // buff/debuff persistente num alvo ou self
};

// ---------------------------------------------------------------------------
// CATÁLOGO DE MAGIAS
// Cada entrada define tudo que o spellEngine precisa para executar a magia.
//
// Campos obrigatórios:
//   id          — chave única (usada como CD key e referência)
//   name        — nome exibido na HUD
//   type        — SPELL_TYPE.*
//   mpCost      — custo de MP
//   cooldownMs  — cooldown em ms após uso
//   minLevel    — level mínimo para usar
//   classes     — array de classes permitidas (null = todas)
//
// Campos de dano/cura (opcionais conforme type):
//   damage      — { base, variance } — dano base + variância (±%)
//   heal        — { base, variance } — cura base + variância
//   aoeRadius   — raio em tiles (tipo AOE)
//   duration    — duração do buff/debuff em ms (tipo BUFF)
//   statMod     — { stat, delta } — modificador de stat para BUFF
//
// Campos visuais:
//   effectId    — ID do efeito no effects_data.json (animação no alvo)
//   selfEffectId — ID do efeito sobre o próprio player ao lançar
//   effectDuration — duração da animação em ms
// ---------------------------------------------------------------------------
export const SPELLS = {
  // ─── DANO DIRETO ────────────────────────────────────────────────────────

  fireball: {
    id: "fireball",
    name: "Bola de Fogo",
    type: SPELL_TYPE.DIRECT,
    mpCost: 20,
    cooldownMs: 2000,
    minLevel: 1,
    classes: ["mago"],
    damage: { base: 30, variance: 0.2 }, // 30 ± 20%
    range: 4, // alcance em tiles
    effectId: 13, // efeito no alvo (explosão de fogo)
    selfEffectId: null,
    effectDuration: 980, // sprite id 13 = 880ms + 100ms margem
    description: "Lança uma bola de fogo que causa dano moderado.",
  },

  lightning: {
    id: "lightning",
    name: "Raio",
    type: SPELL_TYPE.DIRECT,
    mpCost: 35,
    cooldownMs: 3000,
    minLevel: 5,
    classes: ["mago"],
    damage: { base: 55, variance: 0.3 },
    range: 6,
    effectId: 24, // efeito de raio
    selfEffectId: null,
    effectDuration: 1200, // sprite id 24 = 1100ms + 100ms margem
    description: "Conjura um raio que ignora parte da defesa do alvo.",
    ignoreDefPct: 0.4, // ignora 40% da defesa
  },

  holyBolt: {
    id: "holyBolt",
    name: "Projétil Sagrado",
    type: SPELL_TYPE.DIRECT,
    mpCost: 18,
    cooldownMs: 1800,
    minLevel: 1,
    classes: ["clerigo"],
    damage: { base: 25, variance: 0.15 },
    range: 4,
    effectId: 10,
    selfEffectId: null,
    effectDuration: 900, // sprite id 10 = 800ms + 100ms margem
    description:
      "Projétil de energia sagrada. Causa dano extra em mortos-vivos.",
  },

  arrowShot: {
    id: "arrowShot",
    name: "Disparo Certeiro",
    type: SPELL_TYPE.DIRECT,
    mpCost: 10,
    cooldownMs: 1200,
    minLevel: 1,
    classes: ["arqueiro"],
    damage: { base: 20, variance: 0.1 },
    range: 7, // maior alcance
    effectId: 5,
    selfEffectId: null,
    effectDuration: 800, // sprite id 5 = 700ms + 100ms margem
    description: "Disparo preciso à longa distância.",
  },

  // ─── CURA (SELF) ─────────────────────────────────────────────────────────

  healSelf: {
    id: "healSelf",
    name: "Cura",
    type: SPELL_TYPE.SELF,
    mpCost: 25,
    cooldownMs: 4000,
    minLevel: 1,
    classes: null, // todas as classes
    heal: { base: 40, variance: 0.2 },
    effectId: null,
    selfEffectId: 15, // efeito de brilho verde sobre si mesmo
    effectDuration: 1560, // sprite id 15 = 1460ms + 100ms margem
    description: "Restaura pontos de vida do próprio personagem.",
  },

  greatHeal: {
    id: "greatHeal",
    name: "Grande Cura",
    type: SPELL_TYPE.SELF,
    mpCost: 60,
    cooldownMs: 8000,
    minLevel: 8,
    classes: ["clerigo"],
    heal: { base: 100, variance: 0.15 },
    effectId: null,
    selfEffectId: 15, // mesmo efeito de cura, mas mais forte
    effectDuration: 1560, // sprite id 15 = 1460ms + 100ms margem
    description: "Restaura uma grande quantidade de pontos de vida.",
  },

  // ─── AOE ─────────────────────────────────────────────────────────────────

  fireWave: {
    id: "fireWave",
    name: "Onda de Fogo",
    type: SPELL_TYPE.AOE,
    mpCost: 50,
    cooldownMs: 6000,
    minLevel: 6,
    classes: ["mago"],
    damage: { base: 40, variance: 0.25 },
    aoeRadius: 3, // atinge monstros em 3 tiles de raio
    effectId: 2, // efeito de campo de fogo (field)
    selfEffectId: null,
    effectDuration: 1380, // sprite id 2 = 1280ms + 100ms margem
    isField: true, // cria campo persistente no chão
    fieldDuration: 4000, // campo dura 4s
    description: "Projeta uma onda de fogo que queima a área ao redor.",
  },

  earthquake: {
    id: "earthquake",
    name: "Terremoto",
    type: SPELL_TYPE.AOE,
    mpCost: 45,
    cooldownMs: 7000,
    minLevel: 8,
    classes: ["cavaleiro"],
    damage: { base: 35, variance: 0.2 },
    aoeRadius: 2,
    effectId: 25, // efeito de tremor (sprite id 25, 11 frames × 100ms)
    selfEffectId: 25,
    effectDuration: 1200, // 11 frames × 100ms = 1100ms + 100ms margem
    description: "Abala o solo causando dano em área próxima.",
  },

  // ─── BUFF / DEBUFF ───────────────────────────────────────────────────────

  shield: {
    id: "shield",
    name: "Escudo Mágico",
    type: SPELL_TYPE.BUFF,
    mpCost: 30,
    cooldownMs: 10000,
    minLevel: 3,
    classes: ["cavaleiro", "clerigo"],
    duration: 8000, // buff dura 8s
    statMod: { stat: "def", delta: +15 },
    effectId: null,
    selfEffectId: 27,
    effectDuration: 900,
    description: "Envolve o personagem em energia protetora (+15 DEF por 8s).",
  },

  slowCurse: {
    id: "slowCurse",
    name: "Maldição Lenta",
    type: SPELL_TYPE.BUFF, // debuff no alvo
    mpCost: 28,
    cooldownMs: 5000,
    minLevel: 4,
    classes: ["mago", "clerigo"],
    duration: 6000,
    statMod: { stat: "agi", delta: -10 },
    range: 4,
    effectId: 34,
    selfEffectId: null,
    effectDuration: 2300, // sprite id 34 = 2200ms + 100ms margem
    description: "Reduz a agilidade do alvo (-10 AGI por 6s).",
  },
};

// ---------------------------------------------------------------------------
// SPELL_SETS — Define quais magias cada classe tem disponíveis por padrão
// e em qual slot de hotkey (1–9) elas aparecem.
// O professor pode sobrescrever isso via Firebase (players_data/{id}/spells).
// ---------------------------------------------------------------------------
export const SPELL_SETS = {
  cavaleiro: [
    { slot: 1, spellId: "healSelf" },
    { slot: 2, spellId: "shield" },
    { slot: 3, spellId: "earthquake" },
  ],
  mago: [
    { slot: 1, spellId: "fireball" },
    { slot: 2, spellId: "lightning" },
    { slot: 3, spellId: "fireWave" },
    { slot: 4, spellId: "healSelf" },
    { slot: 5, spellId: "slowCurse" },
  ],
  arqueiro: [
    { slot: 1, spellId: "arrowShot" },
    { slot: 2, spellId: "healSelf" },
  ],
  clerigo: [
    { slot: 1, spellId: "holyBolt" },
    { slot: 2, spellId: "healSelf" },
    { slot: 3, spellId: "greatHeal" },
    { slot: 4, spellId: "shield" },
    { slot: 5, spellId: "slowCurse" },
  ],
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Retorna a magia pelo ID ou null.
 * @param {string} spellId
 * @returns {object|null}
 */
export function getSpell(spellId) {
  return SPELLS[spellId] ?? null;
}

/**
 * Retorna os slots padrão de uma classe.
 * @param {string} className
 * @returns {Array<{slot, spellId}>}
 */
export function getDefaultSpellSet(className) {
  return SPELL_SETS[className] ?? [];
}

/**
 * Verifica se um player pode usar uma magia.
 * Retorna { ok: boolean, reason: string|null }
 *
 * @param {object} spell   — entrada de SPELLS
 * @param {object} player  — { stats: { mp, level }, class: string }
 */
export function canCastSpell(spell, player) {
  if (!spell) return { ok: false, reason: "Magia inexistente" };

  const level = player?.stats?.level ?? 1;
  const mp = player?.stats?.mp ?? 0;
  const cls = player?.class ?? null;

  if (level < spell.minLevel) {
    return { ok: false, reason: `Requer level ${spell.minLevel}` };
  }
  if (spell.classes !== null && !spell.classes.includes(cls)) {
    return {
      ok: false,
      reason: `Apenas ${spell.classes.join(" ou ")} pode usar`,
    };
  }
  if (mp < spell.mpCost) {
    return { ok: false, reason: "MP insuficiente" };
  }

  return { ok: true, reason: null };
}

/**
 * Calcula o dano/cura final de uma magia, aplicando variância e stats do caster.
 * PURA: sem I/O, sem Firebase.
 *
 * @param {object} spell      — entrada de SPELLS
 * @param {object} casterStats — { atk, mp, level }
 * @param {object} targetStats — { def } (null para SELF/AOE sem alvo)
 * @returns {{ damage: number, heal: number }}
 */
export function calcSpellResult(spell, casterStats, targetStats = null) {
  const level = Math.max(1, casterStats?.level ?? 1);
  const levelBonus = 1 + (level - 1) * 0.03; // +3% por level acima de 1

  let damage = 0;
  let heal = 0;

  if (spell.damage) {
    const base = spell.damage.base;
    const variance = spell.damage.variance ?? 0;
    const roll = 1 - variance + Math.random() * variance * 2;
    let raw = Math.round(base * roll * levelBonus);

    // Redução por defesa (exceto magias com ignoreDefPct)
    if (targetStats?.def) {
      const ignorePct = spell.ignoreDefPct ?? 0;
      const def = targetStats.def * (1 - ignorePct);
      const reduction = Math.min(0.6, def / (def + raw)); // cap 60% para magia
      raw = Math.max(1, Math.round(raw * (1 - reduction)));
    }

    damage = raw;
  }

  if (spell.heal) {
    const base = spell.heal.base;
    const variance = spell.heal.variance ?? 0;
    const roll = 1 - variance + Math.random() * variance * 2;
    heal = Math.max(1, Math.round(base * roll * levelBonus));
  }

  return { damage, heal };
}
