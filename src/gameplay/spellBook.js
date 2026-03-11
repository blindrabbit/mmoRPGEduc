// =============================================================================
// spellBook.js — mmoRPGEduc
// Camada 3: Catálogo canônico de todas as magias do jogo.
// REGRA: ZERO imports de Firebase, worldStore ou DOM.
//        Dados puros — cada magia é um objeto de configuração.
// =============================================================================

// ---------------------------------------------------------------------------
// TIPOS DE MAGIA
// ---------------------------------------------------------------------------
export const SPELL_TYPE = Object.freeze({
  DIRECT: "direct", // dano direto num alvo único (requer targetLock)
  SELF: "self", // efeito no próprio jogador (heal, buff)
  AOE: "aoe", // área de efeito ao redor do jogador
  BUFF: "buff", // buff/debuff persistente num alvo ou self
  FIELD: "field", // ✅ ADICIONADO: campo persistente no chão com tick damage
});

// ---------------------------------------------------------------------------
// CATÁLOGO DE MAGIAS
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
    damage: { base: 30, variance: 0.2 },
    range: 4,
    effectId: 13,
    selfEffectId: null,
    effectDuration: 980,
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
    effectId: 24,
    selfEffectId: null,
    effectDuration: 1200,
    ignoreDefPct: 0.4,
    description: "Conjura um raio que ignora parte da defesa do alvo.",
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
    effectDuration: 900,
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
    range: 7,
    effectId: 5,
    selfEffectId: null,
    effectDuration: 800,
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
    classes: null,
    heal: { base: 40, variance: 0.2 },
    effectId: null,
    selfEffectId: 15,
    effectDuration: 1560,
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
    selfEffectId: 15,
    effectDuration: 1560,
    description: "Restaura uma grande quantidade de pontos de vida.",
  },

  // ─── AOE (sem campo persistente) ─────────────────────────────────────────
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
    effectId: 25,
    selfEffectId: 25,
    effectDuration: 1200,
    description: "Abala o solo causando dano em área próxima.",
  },

  // ─── CAMPO PERSISTENTE (FIELD) ───────────────────────────────────────────
  fireWave: {
    id: "fireWave",
    name: "Onda de Fogo",
    type: SPELL_TYPE.FIELD, // ✅ Mudado de AOE para FIELD
    mpCost: 50,
    cooldownMs: 6000,
    minLevel: 6,
    classes: ["mago"],
    damage: { base: 40, variance: 0.25 },
    range: 3, // ✅ Alcance para colocar o campo
    fieldData: {
      // ✅ Estrutura padronizada para campos
      fieldId: 2,
      effectId: 2,
      duration: 4000,
      tickDamage: { base: 8, variance: 0.15, interval: 1000 },
      damageType: "fire",
      affectEnemies: true,
      affectAllies: false,
    },
    // Legado para compatibilidade com código existente:
    isField: true,
    fieldDuration: 4000,
    effectId: 2,
    effectDuration: 1380,
    description: "Projeta uma onda de fogo que queima a área ao redor.",
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
    duration: 8000,
    statMod: { stat: "def", delta: +15 },
    effectId: null,
    selfEffectId: 27,
    effectDuration: 900,
    description: "Envolve o personagem em energia protetora (+15 DEF por 8s).",
  },

  slowCurse: {
    id: "slowCurse",
    name: "Maldição Lenta",
    type: SPELL_TYPE.BUFF,
    mpCost: 28,
    cooldownMs: 5000,
    minLevel: 4,
    classes: ["mago", "clerigo"],
    duration: 6000,
    statMod: { stat: "agi", delta: -10 },
    range: 4,
    effectId: 34,
    selfEffectId: null,
    effectDuration: 2300,
    description: "Reduz a agilidade do alvo (-10 AGI por 6s).",
  },
};

// ---------------------------------------------------------------------------
// SPELL_SETS — Slots padrão por classe
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

export function getSpell(spellId) {
  return SPELLS[spellId] ?? null;
}

export function getDefaultSpellSet(className) {
  return SPELL_SETS[className] ?? [];
}

export function canCastSpell(spell, player) {
  if (!spell) return { ok: false, reason: "Magia inexistente" };
  const level = player?.stats?.level ?? 1;
  const mp = player?.stats?.mp ?? 0;
  const cls = player?.class ?? null;

  if (level < spell.minLevel)
    return { ok: false, reason: `Requer level ${spell.minLevel}` };
  if (spell.classes !== null && !spell.classes.includes(cls)) {
    return {
      ok: false,
      reason: `Apenas ${spell.classes.join(" ou ")} pode usar`,
    };
  }
  if (mp < spell.mpCost) return { ok: false, reason: "MP insuficiente" };
  return { ok: true, reason: null };
}

export function calcSpellResult(spell, casterStats, targetStats = null) {
  const level = Math.max(1, casterStats?.level ?? 1);
  const levelBonus = 1 + (level - 1) * 0.03;
  let damage = 0,
    heal = 0;

  if (spell.damage) {
    const { base, variance = 0 } = spell.damage;
    const roll = 1 - variance + Math.random() * variance * 2;
    let raw = Math.round(base * roll * levelBonus);
    if (targetStats?.def) {
      const ignorePct = spell.ignoreDefPct ?? 0;
      const def = targetStats.def * (1 - ignorePct);
      const reduction = Math.min(0.6, def / (def + raw));
      raw = Math.max(1, Math.round(raw * (1 - reduction)));
    }
    damage = raw;
  }
  if (spell.heal) {
    const { base, variance = 0 } = spell.heal;
    const roll = 1 - variance + Math.random() * variance * 2;
    heal = Math.max(1, Math.round(base * roll * levelBonus));
  }
  return { damage, heal };
}
