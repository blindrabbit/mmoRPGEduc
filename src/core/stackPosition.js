export const STACK_POSITION = Object.freeze({
  GROUND: 0,
  ITEM_FIRST: 1,
  ITEM_LAST: 3,
  CREATURE_FIRST: 4,
  CREATURE_LAST: 7,
  EFFECT_FIRST: 8,
  EFFECT_LAST: 9,
  TOP: 10,
});

function _toCategory(category = "") {
  return String(category ?? "").toLowerCase();
}

export function calculateStackPosition(itemFlags = {}, category = "item") {
  const flags = itemFlags ?? {};
  const normalizedCategory = _toCategory(category);

  if (flags.bank || normalizedCategory === "ground") {
    return STACK_POSITION.GROUND;
  }

  if (flags.top || flags.topeffect || normalizedCategory === "top") {
    return STACK_POSITION.TOP;
  }

  if (normalizedCategory === "creature" || normalizedCategory === "player" || normalizedCategory === "monster") {
    return STACK_POSITION.CREATURE_FIRST + 1;
  }

  if (normalizedCategory === "effect") {
    return STACK_POSITION.EFFECT_FIRST;
  }

  if (flags.unpass || flags.unsight) {
    return STACK_POSITION.ITEM_FIRST;
  }

  if (flags.hang || flags.hook) {
    return STACK_POSITION.ITEM_FIRST + 1;
  }

  return STACK_POSITION.ITEM_FIRST + 1;
}

export function resolveStackPosition(metadata = null, category = "item") {
  const meta = metadata ?? {};
  const raw = Number(meta?.game?.stack_position);
  if (Number.isFinite(raw)) return raw;
  return calculateStackPosition(meta?.flags_raw ?? {}, category);
}
