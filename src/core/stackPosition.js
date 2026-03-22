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
  // New format: game.stack_pos; old format fallback: game.stack_position
  const stackPos = Number(meta?.game?.stack_pos ?? meta?.game?.stack_position);
  if (Number.isFinite(stackPos)) return stackPos;
  // ✅ Novo: flags planos em game; Fallback: flags_raw (legado protobuf)
  const game = meta?.game || {};
  const flags_raw = meta?.flags_raw || {};
  const flags = {
    bank:      game.bank      ?? flags_raw.bank,
    top:       game.top       ?? flags_raw.top,
    topeffect: game.topeffect ?? flags_raw.topeffect,
    unpass:    game.unpass    ?? flags_raw.unpass,
    unsight:   game.unsight   ?? flags_raw.unsight,
    hang:      game.hang      ?? flags_raw.hang,
    hook:      game.hook      ?? flags_raw.hook,
  };
  return calculateStackPosition(flags, category);
}
