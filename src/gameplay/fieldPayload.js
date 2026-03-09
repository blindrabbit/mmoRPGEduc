// =============================================================================
// fieldPayload.js — Payload canônico para campos persistentes
// Reutilizável por monstros e players.
// =============================================================================

export function buildFieldPayload({
  id,
  x,
  y,
  z = 7,
  now = Date.now(),
  damage = 0,
  fieldId = null,
  effectId = null,
  fieldDuration = 5000,
  tickRate = 1000,
  statusType = null,
} = {}) {
  return {
    id: String(id ?? ""),
    x: Number(x ?? 0),
    y: Number(y ?? 0),
    z: Number(z ?? 7),
    damage: Number(damage ?? 0),
    fieldId: Number(fieldId ?? 0) || null,
    effectId: Number(effectId ?? 0) || null,
    fieldDuration: Number(fieldDuration ?? 5000),
    startTime: Number(now),
    expiry: Number(now + Number(fieldDuration ?? 5000)),
    tickRate: Number(tickRate ?? 1000),
    statusType: statusType ?? null,
    lastTick: 0,
  };
}

export function buildFieldEffectFallbackPayload({
  x,
  y,
  z = 7,
  now = Date.now(),
  isPersistent = true,
  isField = true,
  fieldDuration = 5000,
  effectDuration = 1200,
  effectId = 2,
} = {}) {
  const duration = Number(isPersistent ? fieldDuration : effectDuration);
  return {
    x: Number(x ?? 0),
    y: Number(y ?? 0),
    z: Number(z ?? 7),
    startTime: Number(now),
    expiry: Number(now + duration),
    isField: Boolean(isField),
    fieldDuration: Number(fieldDuration ?? 5000),
    effectId: Number(effectId ?? 2),
  };
}
