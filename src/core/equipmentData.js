// src/core/equipmentData.js
// Dados de equipamentos adaptados ao sistema de atributos (FOR/INT/AGI/VIT)
// shootType e wandType são usados pelo sistema de animação de ataque
//
// Nomes de slot canônicos (lowercase, alinhados com INVENTORY_SLOTS):
//   right, left, head, neck, body, back, legs, feet, finger, ammo

export const EQUIPMENT_DATA = {

  // ─── ARMAS CORPO-A-CORPO ───────────────────────────────────────────────────

  3268: {
    name: "Hand Axe",
    slot: "right",
    weaponType: "axe",          // tipo de animação de swing
    shootType: null,
    attack: 10,
    defense: 5,
    weight: 1800,
    statBonus: {},
    combatProfile: "melee",
  },

  3273: {
    name: "Sabre",
    slot: "right",
    weaponType: "sword",
    shootType: null,
    attack: 12,
    defense: 10,
    extraDef: 1,
    weight: 2500,
    statBonus: {},
    combatProfile: "melee",
  },

  3337: {
    name: "Bone Club",
    slot: "right",
    weaponType: "club",
    shootType: null,
    attack: 12,
    defense: 8,
    weight: 3900,
    statBonus: {},
    combatProfile: "melee",
  },

  // ─── ARMAS DE DISTÂNCIA ────────────────────────────────────────────────────

  3277: {
    name: "Spear",
    slot: "right",
    weaponType: "distance",
    shootType: "spear",         // projétil: animação de lança voando
    range: 3,
    attack: 25,
    maxHitChance: 76,
    breakChance: 3,             // % de chance de quebrar ao usar
    weight: 2000,
    statBonus: {},
    combatProfile: "distance",
  },

  // ─── ARMAS MÁGICAS ─────────────────────────────────────────────────────────

  3066: {
    name: "Snakebite Rod",
    slot: "right",
    weaponType: "wand",
    shootType: "smallearth",    // projétil: animação de terra/veneno
    wandType: "earth",          // elemento: verde/terra
    range: 3,
    minDamage: 8,
    maxDamage: 18,
    manaCost: 2,
    weight: 1900,
    statBonus: { INT: 1 },
    combatProfile: "caster",
    vocations: ["druid"],
  },

  3074: {
    name: "Wand of Vortex",
    slot: "right",
    weaponType: "wand",
    shootType: "energy",        // projétil: animação de energia/elétrica
    wandType: "energy",         // elemento: azul/energia
    range: 3,
    minDamage: 8,
    maxDamage: 18,
    manaCost: 1,
    weight: 1900,
    statBonus: { INT: 1 },
    combatProfile: "caster",
    vocations: ["mage"],
  },

  3059: {
    name: "Spellbook",
    slot: "left",               // mão esquerda (slot de escudo para magos)
    weaponType: "spellbook",
    shootType: null,
    defense: 14,
    weight: 1800,
    statBonus: { INT: 2 },
    combatProfile: "caster",
    vocations: ["mage", "druid"],
  },

  // ─── ESCUDO ────────────────────────────────────────────────────────────────

  3412: {
    name: "Wooden Shield",
    slot: "left",
    weaponType: "shield",
    shootType: null,
    defense: 14,
    weight: 4000,
    statBonus: {},
    combatProfile: "tank",
  },

  // ─── ARMADURAS ─────────────────────────────────────────────────────────────

  3355: {
    name: "Leather Helmet",
    slot: "head",
    weaponType: null,
    shootType: null,
    armor: 1,
    weight: 2200,
    statBonus: {},
  },

  3361: {
    name: "Leather Armor",
    slot: "body",
    weaponType: null,
    shootType: null,
    armor: 4,
    weight: 6000,
    statBonus: {},
  },

  3559: {
    name: "Leather Legs",
    slot: "legs",
    weaponType: null,
    shootType: null,
    armor: 1,
    weight: 1800,
    statBonus: {},
  },

  3552: {
    name: "Leather Boots",
    slot: "feet",
    weaponType: null,
    shootType: null,
    armor: 1,
    weight: 900,
    statBonus: {},
  },
};

// Mapeamento de shootType → sprite/efeito visual (usado pelo sistema de animação)
export const SHOOT_TYPE_ANIMATION = {
  spear:      { spriteId: null, color: null },      // lança física
  smallearth: { spriteId: null, color: "green" },   // projétil terra/veneno
  energy:     { spriteId: null, color: "blue" },    // projétil energia
};

// Mapeamento de wandType → elemento (para cálculo de dano elemental futuro)
export const WAND_ELEMENT = {
  earth:  "earth",
  energy: "energy",
};
