import { dbGet, batchWrite, PATHS } from "../core/db.js";
import { makeMonster } from "../core/schema.js";
import { MONSTER_TEMPLATES } from "./monsterData.js";

function getHpRatio(monster) {
  const currentHp = Number(monster?.stats?.hp);
  const currentMaxHp = Number(monster?.stats?.maxHp);
  if (
    !Number.isFinite(currentHp) ||
    !Number.isFinite(currentMaxHp) ||
    currentMaxHp <= 0
  ) {
    return 1;
  }
  return Math.max(0, Math.min(1, currentHp / currentMaxHp));
}

function buildMigratedMonster(monsterId, rawMonster, options = {}) {
  const template = MONSTER_TEMPLATES[rawMonster?.species];
  if (!template) {
    return null;
  }

  const preserveHpPercent = options.preserveHpPercent !== false;
  const hpRatio = getHpRatio(rawMonster);
  const nextMaxHp = Number(template.stats?.maxHp ?? template.stats?.hp ?? 100);
  const nextHp = rawMonster?.dead
    ? 0
    : preserveHpPercent
      ? Math.max(1, Math.round(nextMaxHp * hpRatio))
      : nextMaxHp;

  return makeMonster({
    ...rawMonster,
    id: monsterId,
    species: rawMonster?.species ?? template.species ?? monsterId,
    name: rawMonster?.name ?? template.name,
    recommendedPlayerLevel:
      rawMonster?.recommendedPlayerLevel ?? template.recommendedPlayerLevel,
    threatTier: rawMonster?.threatTier ?? template.threatTier,
    appearance: {
      ...template.appearance,
      ...(rawMonster?.appearance ?? {}),
    },
    stats: {
      ...template.stats,
      hp: nextHp,
      maxHp: nextMaxHp,
      elite: rawMonster?.stats?.elite ?? template.stats?.elite,
    },
    respawnDelay: rawMonster?.respawnDelay ?? template.respawnDelay,
    corpseFrames: rawMonster?.corpseFrames ?? template.corpseFrames,
    corpseDuration: rawMonster?.corpseDuration ?? template.corpseDuration,
  });
}

export async function migrateMonstersToCurrentTemplates(options = {}) {
  const monsters = (await dbGet(PATHS.monsters)) ?? {};
  const updates = {};
  let migrated = 0;
  let skipped = 0;

  for (const [monsterId, rawMonster] of Object.entries(monsters)) {
    if (!rawMonster || typeof rawMonster !== "object") {
      skipped++;
      continue;
    }

    const migratedMonster = buildMigratedMonster(
      monsterId,
      rawMonster,
      options,
    );
    if (!migratedMonster) {
      skipped++;
      continue;
    }

    updates[PATHS.monster(monsterId)] = migratedMonster;
    migrated++;
  }

  if (migrated > 0) {
    await batchWrite(updates);
  }

  return {
    success: true,
    migrated,
    skipped,
  };
}
