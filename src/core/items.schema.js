// src/core/items.schema.js
export const WEAPON_TYPES = {
  MELEE: 'melee',      // Espadas, machados, clubes - corpo-a-corpo
  DISTANCE: 'distance', // Arcos, bestas, throwing - à distância
  SHIELD: 'shield',    // Escudos - defesa passiva
  AMMO: 'ammo',        // Flechas, bolts - consumível para distance
};

export const WEAPON_DEFINITIONS = {
  // 🗡️ Melee
  sword_iron: {
    id: 'sword_iron',
    name: 'Iron Sword',
    type: WEAPON_TYPES.MELEE,
    attack: 12,
    defense: 8,
    range: 1, // sempre 1 para melee
    hitChance: 90, // % base de acerto
    speed: 1800, // ms entre ataques
    twoHanded: false,
    requirements: { level: 7, skills: { sword: 10 } },
  },
  
  // 🏹 Distance
  bow_hunter: {
    id: 'bow_hunter',
    name: 'Hunter Bow',
    type: WEAPON_TYPES.DISTANCE,
    attack: 18,
    hitChance: 85,
    range: 5, // tiles de alcance
    speed: 2200,
    ammoRequired: 'arrow_normal',
    requirements: { level: 10, skills: { distance: 15 } },
  },
  
  // 🛡️ Shield
  shield_wood: {
    id: 'shield_wood',
    name: 'Wooden Shield',
    type: WEAPON_TYPES.SHIELD,
    defense: 10,
    blockChance: 20, // % de bloqueio total do dano
  },
};