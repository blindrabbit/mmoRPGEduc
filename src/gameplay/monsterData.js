// ═══════════════════════════════════════════════════════════════
// monsterData.js — Catálogo de monstros do Nexo
//
// Os monstros definidos aqui manualmente têm prioridade.
// Monstros extraídos do mapa (wolf, rotworm, rotworm_queen, etc.)
// são adicionados automaticamente via monsterData.generated.js.
//
// Como adicionar um novo monstro:
//   1. Copie um bloco existente (ex: "rat")
//   2. Troque a chave (ex: "wolf")
//   3. Ajuste os campos conforme a tabela abaixo
//
// ── CAMPOS DE COMPORTAMENTO ──────────────────────────────────
//   behavior.range       → distância que o monstro enxerga players (SQMs)
//   behavior.loseAggro   → distância que ele desiste de perseguir
//   behavior.maxDistance → até onde ele se afasta do spawn
//
// ── CAMPOS DE ATAQUE ─────────────────────────────────────────
//   type: "melee"  → ataque corpo a corpo (range 1)
//   type: "ranged" → projétil à distância
//   type: "area"   → atinge múltiplos tiles via shape
//   chance         → chance de executar no turno (0..1 ou 0..100)

// ── CAMPOS DE STATUS (novo modelo) ───────────────────────────
//   FOR → força física / ataque base
//   INT → poder mágico / afinidade arcana
//   AGI → acerto, esquiva e mobilidade
//   VIT → resistência e defesa base
//   combatProfile → perfil de derivação: balanced, skirmisher, caster, tank, boss
//
// ── SHAPE (ataques em área) ───────────────────────────────────
//   M = posição do monstro
//   X = tile que recebe dano
//   0 = tile vazio (sem dano)
//   O shape é rotacionado automaticamente pela direção do monstro
//
// ── CAMPOS DE EFEITO VISUAL (novo atlas) ─────────────────────
//   effectId      → ID do efeito no effects_data.json
//   fieldId       → ID do field no fields_data.json (quando isField=true)
//   effectDuration→ duração total da animação (ms)
//   isPersistent  → true = efeito fica no chão após o ataque
//   isField       → true = field que causa dano periódico
//   fieldDuration → quanto tempo o field fica ativo (ms)
//   tickRate      → intervalo de dano do field (ms)
//   statusType    → efeito de status: "burning", "poison", "frozen"
// ═══════════════════════════════════════════════════════════════

import { MONSTER_SPAWN_DATA } from "./monsterData.generated.js";

export const MONSTER_TEMPLATES = {
  // ─────────────────────────────────────────────────────────────
  // RAT — monstro iniciante, fraco e agressivo
  // Bom para testar mecânicas de área
  // ─────────────────────────────────────────────────────────────
  rat: {
    name: "Rat",
    species: "rat",
    recommendedPlayerLevel: 1,
    threatTier: "starter",

    appearance: {
      outfitId: "rat",
      outfitPack: "monstros_01",
      speed: 130, // quanto maior, mais rápido
    },

    stats: {
      hp: 36,
      maxHp: 36,
      FOR: 3,
      INT: 0,
      AGI: 8,
      VIT: 2,
      combatProfile: "skirmisher",
      level: 1,
      xpValue: 10,
    },

    behavior: {
      range: 10, // SQMs de visão
      loseAggro: 15, // SQMs para desistir
      maxDistance: 20, // raio máximo do spawn
    },

    corpseFrames: ["2660", "2661", "2662"],
    corpseDuration: 10000, // ms até o cadáver sumir
    respawnDelay: 30000, // ms até renascer

    attacks: [
      // ── Ataque corpo a corpo básico ──────────────────────────
      {
        name: "Mordida",
        type: "melee",
        range: 1,
        damage: 6,
        cooldown: 1500,
        chance: 1,
        effectId: 1, // ID do efeito no atlas de monstros
      },

      // ── Onda de fogo (área em cone, não persistente) ─────────
      {
        name: "Onda de Fogo",
        type: "area",
        range: 3,
        damage: 4,
        cooldown: 4000,
        chance: 0.2,
        isPersistent: false,
        effectId: 7, // ID do efeito no atlas de monstros
        effectDuration: 1200,
        shape: ["XXXXX", "XXXXX", "0XXX0", "0XXX0", "00X00", "00M00"],
      },

      // ── Campo de fogo (área persistente que queima no chão) ───
      {
        name: "Campo de Fogo",
        type: "area",
        range: 1,
        damage: 3,
        cooldown: 7000,
        chance: 0.12,
        isPersistent: true,
        isField: true,
        fieldId: 2118,
        fieldDuration: 4000,
        tickRate: 1500,
        statusType: "burning",
        effectId: 16,
        effectDuration: 1200,
        shape: ["00X00", "00M00"],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // SKELETON MAGE — mago à distância, fragil mas perigoso
  // ─────────────────────────────────────────────────────────────
  skeleton_mage: {
    name: "Skeleton Mage",
    species: "skeleton_mage",
    recommendedPlayerLevel: 5,
    threatTier: "elite",

    appearance: {
      outfitId: "2005",
      outfitPack: "monstros_01",
      speed: 90,
    },

    stats: {
      hp: 96,
      maxHp: 96,
      FOR: 2,
      INT: 16,
      AGI: 9,
      VIT: 5,
      combatProfile: "caster",
      level: 6,
      xpValue: 18,
    },

    behavior: {
      range: 8,
      loseAggro: 12,
      maxDistance: 15,
    },

    corpseFrames: ["2663", "2664"],
    corpseDuration: 8000,
    respawnDelay: 45000,

    attacks: [
      {
        name: "Bola de Fogo",
        type: "ranged",
        range: 5,
        damage: 17,
        cooldown: 2800,
        chance: 0.75,
      },
      {
        name: "Explosão de Energia",
        type: "ranged",
        range: 2,
        damage: 26,
        cooldown: 5200,
        chance: 0.28,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // DRAGON — boss poderoso, ataque em área e corpo a corpo
  // ─────────────────────────────────────────────────────────────
  dragon: {
    name: "Red Dragon",
    species: "dragon",
    recommendedPlayerLevel: 18,
    threatTier: "boss",

    appearance: {
      outfitId: "3000",
      outfitPack: "monstros_01",
      speed: 100,
    },

    stats: {
      hp: 1800,
      maxHp: 1800,
      FOR: 26,
      INT: 18,
      AGI: 12,
      VIT: 22,
      combatProfile: "boss",
      level: 25,
      xpValue: 48,
    },

    behavior: {
      range: 15,
      loseAggro: 20,
      maxDistance: 10, // boss fica perto do spawn
    },

    corpseFrames: ["3100", "3101", "3102"],
    corpseDuration: 30000,
    respawnDelay: 300000, // 5 minutos

    // Imunidades: lista de statusTypes/elementos que causam 0 dano e não bloqueiam rota
    immunities: ["burning", "fire"],

    attacks: [
      {
        name: "Baforada de Fogo",
        type: "area",
        range: 4,
        damage: 44,
        cooldown: 4500,
        chance: 0.45,
        isPersistent: false,
        effectId: 1,
        effectDuration: 1500,
        shape: ["0XXX0", "XXXXX", "XXXXX", "0XMX0"],
      },
      {
        name: "Mordida",
        type: "melee",
        range: 1,
        damage: 30,
        cooldown: 2000,
        chance: 1,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // SLIME — monstro lento, venenoso, bom para ensinar status
  // ─────────────────────────────────────────────────────────────
  slime: {
    name: "Slime",
    species: "slime",
    recommendedPlayerLevel: 2,
    threatTier: "normal",

    appearance: {
      outfitId: "slime",
      outfitPack: "monstros_01",
      speed: 60, // bem lento
    },

    stats: {
      hp: 72,
      maxHp: 72,
      FOR: 4,
      INT: 1,
      AGI: 2,
      VIT: 11,
      combatProfile: "tank",
      level: 3,
      xpValue: 14,
    },

    behavior: {
      range: 6,
      loseAggro: 8,
      maxDistance: 10,
    },

    corpseFrames: ["2670", "2671"],
    corpseDuration: 5000,
    respawnDelay: 20000,

    // Imunidades: slime é imune ao próprio veneno
    immunities: ["poison"],

    attacks: [
      {
        name: "Gosma",
        type: "melee",
        range: 1,
        damage: 7,
        cooldown: 2200,
        chance: 1,
      },
      {
        name: "Nuvem Venenosa",
        type: "area",
        range: 1,
        damage: 5,
        cooldown: 7000,
        chance: 0.35,
        isPersistent: true,
        isField: true,
        fieldDuration: 8000,
        tickRate: 1500,
        statusType: "poison",
        effectId: 2,
        effectDuration: 1000,
        shape: ["0X0", "XMX", "0X0"],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Injeta monstros do mapa (gerados) que ainda não têm template manual.
// Os templates manuais acima sempre têm prioridade.
// (o import de MONSTER_SPAWN_DATA está no topo do arquivo)
// ---------------------------------------------------------------------------
for (const [key, tmpl] of Object.entries(MONSTER_SPAWN_DATA?.monsters ?? {})) {
  if (!MONSTER_TEMPLATES[key]) {
    MONSTER_TEMPLATES[key] = tmpl;
  }
}
