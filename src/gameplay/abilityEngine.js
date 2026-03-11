// =============================================================================
// abilityEngine.js — Execucao unificada de abilities (players + monstros)
// Centraliza logicas compartilhadas de AOE, efeitos visuais e status.
// =============================================================================

import { resolveStatusEffectId } from "./abilityCore.js";

export function getAreaOffsets(radius) {
  const out = [];
  const r = Math.max(0, Number(radius ?? 0));
  const ceil = Math.ceil(r);
  for (let dx = -ceil; dx <= ceil; dx++) {
    for (let dy = -ceil; dy <= ceil; dy++) {
      if (Math.hypot(dx, dy) > r + 0.5) continue;
      out.push({ dx, dy });
    }
  }
  return out;
}

export function buildAreaEffectUpdates({
  effectId,
  casterX,
  casterY,
  casterZ,
  radius,
  now,
  idPrefix,
  isField = false,
  fieldDuration = 0,
  effectDuration = 700,
  basePath,
} = {}) {
  if (!Number.isFinite(Number(effectId))) return {};

  const updates = {};
  const offsets = getAreaOffsets(radius);

  for (const { dx, dy } of offsets) {
    const fxId = `${idPrefix}_${now}_${dx}_${dy}`;
    updates[`${basePath}/${fxId}`] = {
      id: fxId,
      type: "effect",
      effectId: Number(effectId),
      x: Number(casterX) + dx,
      y: Number(casterY) + dy,
      z: Number(casterZ ?? 7),
      startTime: Number(now),
      effectDuration: Number(effectDuration),
      expiry: Number(now + Number(effectDuration)),
      isField: Boolean(isField),
      fieldDuration: Number(fieldDuration ?? 0),
    };
  }

  return updates;
}

export async function executeAreaDamageOnMonsters({
  caster,
  casterId,
  abilityId,
  radius,
  monsters,
  calcDamage,
  applyHp,
  emitDamage,
  emitKill,
} = {}) {
  const casterX = Math.round(caster?.x ?? 0);
  const casterY = Math.round(caster?.y ?? 0);
  const casterZ = caster?.z ?? 7;
  const hitResults = [];

  for (const [monsterId, mob] of Object.entries(monsters ?? {})) {
    if (!mob || (mob.stats?.hp ?? 0) <= 0 || mob.dead) continue;
    if ((mob.z ?? 7) !== casterZ) continue;

    const dist = Math.hypot((mob.x ?? 0) - casterX, (mob.y ?? 0) - casterY);
    if (dist > Number(radius ?? 0) + 0.5) continue;

    const damage = Number(calcDamage?.(mob) ?? 0);
    if (damage <= 0) continue;

    const newHp = Math.max(0, (mob.stats?.hp ?? 0) - damage);
    hitResults.push({ id: monsterId, mob, damage, newHp });

    emitDamage?.({
      attackerId: casterId,
      defenderId: monsterId,
      defenderType: "monsters",
      damage,
      isCritical: false,
      abilityId,
      defenderX: mob.x,
      defenderY: mob.y,
      defenderZ: mob.z ?? casterZ,
    });

    if (newHp <= 0) {
      emitKill?.({
        attackerId: casterId,
        victimId: monsterId,
        victimType: "monsters",
        victimX: mob.x,
        victimY: mob.y,
        victimZ: mob.z ?? casterZ,
      });
    }
  }

  await Promise.all(hitResults.map(({ id, newHp }) => applyHp?.(id, newHp)));
  return hitResults;
}

export function buildStatusEffectVisualPayload({
  statusType,
  targetId,
  x,
  y,
  z,
  now,
  fallbackEffectId,
  duration = 1200,
} = {}) {
  const effectId = resolveStatusEffectId(statusType, fallbackEffectId);
  const id = `status_${String(statusType ?? "status")}_${String(targetId ?? "target")}_${Number(now ?? Date.now())}`;

  return {
    id,
    payload: {
      id,
      type: "effect",
      x: Number(x ?? 0),
      y: Number(y ?? 0),
      z: Number(z ?? 7),
      startTime: Number(now ?? Date.now()),
      expiry: Number((now ?? Date.now()) + Number(duration ?? 1200)),
      isField: false,
      fieldDuration: 0,
      effectId,
      effectDuration: Number(duration ?? 1200),
      targetId: targetId ?? null,
      statusType: statusType ?? null,
    },
  };
}
