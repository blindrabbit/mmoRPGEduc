// ═══════════════════════════════════════════════════════════════
// monsterData.generated.js — Gerado automaticamente por monsterExtractor.js
// NÃO EDITAR MANUALMENTE! Execute o extractor para atualizar.
// ═══════════════════════════════════════════════════════════════

export const MONSTER_SPAWN_DATA = {
  version: '1.0',
  generatedAt: '2026-03-29T16:42:43.419Z',
  totalMonsters: 3,
  monsters: {
    rotworm: {
        "name": "Rotworm",
        "normalizedName": "rotworm",
        "appearance": {
            "outfitId": "rotworm",
            "outfitPack": "monstros_01",
            "lookType": null,
            "speed": 100
        },
        "stats": {
            "hp": 65,
            "maxHp": 100,
            "FOR": 10,
            "INT": 0,
            "AGI": 6,
            "VIT": 8,
            "combatProfile": "balanced",
            "level": 3,
            "xpValue": 40
        },
        "behavior": {
            "range": 8,
            "loseAggro": 12,
            "maxDistance": 15
        },
        "attacks": [
            {
                "name": "Bite",
                "type": "melee",
                "range": 1,
                "damage": 12,
                "cooldown": 1800,
                "chance": 1,
                "effectId": 1
            }
        ],
        "voices": [],
        "loot": [],
        "elements": {},
        "immunities": [],
        "corpseFrames": [
            "5974",
            "5975",
            "5976"
        ],
        "corpseDuration": 10000,
        "respawnDelay": 60000,
        "threatTier": "starter",
        "canaryData": null
    },
    rotworm_queen: {
        "name": "Rotworm Queen",
        "normalizedName": "rotworm_queen",
        "appearance": {
            "outfitId": "rotworm_queen",
            "outfitPack": "monstros_01",
            "lookType": null,
            "speed": 100
        },
        "stats": {
            "hp": 100,
            "maxHp": 100,
            "FOR": 10,
            "INT": 0,
            "AGI": 10,
            "VIT": 10,
            "combatProfile": "balanced",
            "level": 5,
            "xpValue": 50
        },
        "behavior": {
            "range": 10,
            "loseAggro": 15,
            "maxDistance": 20
        },
        "attacks": [
            {
                "name": "Melee",
                "type": "melee",
                "range": 1,
                "damage": 10,
                "cooldown": 1500,
                "chance": 1,
                "effectId": 1
            }
        ],
        "voices": [],
        "loot": [],
        "elements": {},
        "immunities": [],
        "corpseFrames": [
            "5968"
        ],
        "corpseDuration": 10000,
        "respawnDelay": 60000,
        "threatTier": "common",
        "canaryData": null
    },
    wolf: {
        "name": "Wolf",
        "normalizedName": "wolf",
        "appearance": {
            "outfitId": "wolf",
            "outfitPack": "monstros_01",
            "lookType": 27,
            "speed": 82
        },
        "stats": {
            "hp": 25,
            "maxHp": 25,
            "FOR": 8,
            "INT": 0,
            "AGI": 12,
            "VIT": 5,
            "combatProfile": "skirmisher",
            "level": 2,
            "xpValue": 18
        },
        "behavior": {
            "range": 10,
            "loseAggro": 15,
            "maxDistance": 20
        },
        "attacks": [
            {
                "name": "melee",
                "type": "melee",
                "range": 1,
                "damage": 20,
                "cooldown": 2000,
                "chance": 1,
                "effectId": 1
            }
        ],
        "voices": [
            {
                "sentence": "Yoooohhuuuu!",
                "yell": false
            },
            {
                "sentence": "Grrrrrrr",
                "yell": false
            }
        ],
        "loot": [
            {
                "id": 3577,
                "chance": 55000,
                "countmax": 1
            },
            {
                "id": 5897,
                "chance": 980,
                "countmax": 1
            }
        ],
        "elements": {
            "physical": 0,
            "energy": 0,
            "earth": 5,
            "fire": 0,
            "lifedrain": 0,
            "manadrain": 0,
            "drown": 0,
            "ice": -5,
            "holy": 5,
            "death": -5
        },
        "immunities": [
            "paralyze",
            "outfit",
            "invisible",
            "bleed"
        ],
        "corpseFrames": [
            "5968"
        ],
        "corpseDuration": 10000,
        "respawnDelay": 60000,
        "threatTier": "starter",
        "canaryData": {
            "flags": {
                "summonable": "true",
                "attackable": "true",
                "hostile": "true",
                "convinceable": "true",
                "pushable": "true",
                "rewardBoss": "false",
                "illusionable": "true",
                "canPushItems": "false",
                "canPushCreatures": "false",
                "staticAttackChance": "90",
                "targetDistance": "1",
                "runHealth": "8",
                "healthHidden": "false",
                "isBlockable": "false",
                "canWalkOnEnergy": "false",
                "canWalkOnFire": "false",
                "canWalkOnPoison": "false"
            },
            "immunities": [
                "paralyze",
                "outfit",
                "invisible",
                "bleed"
            ],
            "elements": {
                "physical": 0,
                "energy": 0,
                "earth": 5,
                "fire": 0,
                "lifedrain": 0,
                "manadrain": 0,
                "drown": 0,
                "ice": -5,
                "holy": 5,
                "death": -5
            },
            "description": "a wolf",
            "raceId": 27,
            "lookType": 27,
            "corpse": 5968
        }
    },
  },
};

export default MONSTER_SPAWN_DATA;
