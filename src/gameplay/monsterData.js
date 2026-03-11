// ═══════════════════════════════════════════════════════════════
// monsterData.js — Catálogo de monstros do Nexo
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

export const MONSTER_TEMPLATES = {
  // ─────────────────────────────────────────────────────────────
  // RAT — monstro iniciante, fraco e agressivo
  // Bom para testar mecânicas de área
  // ─────────────────────────────────────────────────────────────
  rat: {
    name: "Rat",
    species: "rat",

    appearance: {
      outfitId: "rat",
      outfitPack: "monstros_01",
      speed: 130, // quanto maior, mais rápido
    },

    stats: {
      hp: 250,
      maxHp: 250,
      atk: 5,
      def: 0,
      agi: 10,
      level: 1,
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
        damage: 5,
        cooldown: 1500,
        chance: 1,
        effectId: 1, // ID do efeito no atlas de monstros
      },

      // ── Onda de fogo (área em cone, não persistente) ─────────
      {
        name: "Onda de Fogo",
        type: "area",
        range: 3,
        damage: 1,
        cooldown: 4000,
        chance: 0.35,
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
        damage: 10,
        cooldown: 5000,
        chance: 0.25,
        isPersistent: true,
        isField: true,
        fieldId: 2118,
        fieldDuration: 60000,
        tickRate: 1000,
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

    appearance: {
      outfitId: "2005",
      outfitPack: "monstros_01",
      speed: 90,
    },

    stats: {
      hp: 60,
      maxHp: 60,
      atk: 15,
      def: 2,
      agi: 5,
      level: 6,
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
        damage: 15,
        cooldown: 3000,
        chance: 0.75,
      },
      {
        name: "Explosão de Energia",
        type: "ranged",
        range: 2,
        damage: 25,
        cooldown: 5000,
        chance: 0.3,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // DRAGON — boss poderoso, ataque em área e corpo a corpo
  // ─────────────────────────────────────────────────────────────
  dragon: {
    name: "Red Dragon",
    species: "dragon",

    appearance: {
      outfitId: "3000",
      outfitPack: "monstros_01",
      speed: 100,
    },

    stats: {
      hp: 5000,
      maxHp: 5000,
      atk: 50,
      def: 20,
      agi: 8,
      level: 25,
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
        damage: 40,
        cooldown: 5000,
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
        damage: 20,
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

    appearance: {
      outfitId: "slime",
      outfitPack: "monstros_01",
      speed: 60, // bem lento
    },

    stats: {
      hp: 40,
      maxHp: 40,
      atk: 3,
      def: 5,
      agi: 2,
      level: 3,
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
        damage: 3,
        cooldown: 2000,
        chance: 1,
      },
      {
        name: "Nuvem Venenosa",
        type: "area",
        range: 1,
        damage: 5,
        cooldown: 8000,
        chance: 0.4,
        isPersistent: true,
        isField: true,
        fieldDuration: 10000,
        tickRate: 1500,
        statusType: "poison",
        effectId: 2,
        effectDuration: 1000,
        shape: ["0X0", "XMX", "0X0"],
      },
    ],
  },
};
