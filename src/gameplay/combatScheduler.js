// =============================================================================
// combatScheduler.js — relógio central de combate
// Define o quantum global de combate e helpers compartilhados de cooldown/fila.
// =============================================================================

import { WORLDENGINE } from "../core/config.js";

export const COMBAT_TICK_MS = Math.max(
  100,
  Number(WORLDENGINE.worldTickMs ?? 250),
);

export function normalizeCombatCooldownMs(value, minimumMs = COMBAT_TICK_MS) {
  const base = Math.max(1, Number(minimumMs ?? COMBAT_TICK_MS));
  const raw = Math.max(base, Number(value ?? base));
  return Math.ceil(raw / base) * base;
}

export function getCombatTickBucket(now = Date.now()) {
  return Math.floor(Number(now ?? Date.now()) / COMBAT_TICK_MS);
}

export function shouldRunCombatTick(lastBucket, now = Date.now()) {
  const currentBucket = getCombatTickBucket(now);
  return currentBucket !== Number(lastBucket ?? -1);
}

export function getActionCooldownKey(actionKey) {
  const raw = String(actionKey ?? "").replace(/[^a-zA-Z0-9]/g, "");
  if (!raw) return null;
  if (raw.startsWith("cd") && raw.length > 2) return raw;
  return `cd${raw[0].toUpperCase()}${raw.slice(1)}`;
}

export function getMonsterAttackCooldownKey(attackName) {
  return getActionCooldownKey(attackName) ?? "cdAttack";
}

export function getCooldownTimestamp(entity, actionKey) {
  const cooldownKey = getActionCooldownKey(actionKey);
  if (!entity || !cooldownKey) return 0;
  const direct = Number(entity[cooldownKey] ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (cooldownKey === getActionCooldownKey("basicAttack")) {
    const lastAttack = Number(entity.lastAttack ?? 0);
    if (Number.isFinite(lastAttack) && lastAttack > 0) return lastAttack;
  }
  return 0;
}

export function getCooldownRemainingMs(
  entity,
  actionKey,
  cooldownMs,
  now = Date.now(),
) {
  const normalized = normalizeCombatCooldownMs(cooldownMs);
  const lastUsedAt = getCooldownTimestamp(entity, actionKey);
  return Math.max(0, lastUsedAt + normalized - Number(now ?? Date.now()));
}

export function isCombatActionReady(
  entity,
  actionKey,
  cooldownMs,
  now = Date.now(),
) {
  return getCooldownRemainingMs(entity, actionKey, cooldownMs, now) <= 0;
}

export function getQueuedCombatActionKey(actionId, action = {}) {
  const playerId = String(action?.playerId ?? "");
  const type = String(action?.type ?? "unknown");
  if (!playerId) return String(actionId ?? `${type}:${Date.now()}`);
  if (type === "spell") {
    return `${playerId}:spell:${String(action?.spellId ?? "unknown")}`;
  }
  if (type === "attack") {
    return `${playerId}:attack`;
  }
  return `${playerId}:${type}`;
}
