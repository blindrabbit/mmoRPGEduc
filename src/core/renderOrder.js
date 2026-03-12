import { calculateStackPosition } from "./stackPosition.js";

function _padNumber(value, length = 6) {
  const n = Math.floor(Number(value) || 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}${String(Math.abs(n)).padStart(length, "0")}`;
}

export function getRenderKey(entity) {
  const z = Number(entity?.z ?? 7);
  const stack = Number(
    entity?.stackPosition ??
      calculateStackPosition(entity?.flags ?? {}, entity?.category ?? "item"),
  );

  const y = Math.floor(Number(entity?.y ?? 0) * 1000);
  const x = Math.floor(Number(entity?.x ?? 0) * 1000);

  return `${_padNumber(z, 2)}-${_padNumber(stack, 2)}-${_padNumber(-y, 7)}-${_padNumber(x, 7)}`;
}

export function sortEntitiesForRender(entities, playerZ) {
  return [...(entities ?? [])]
    .filter((e) => Number(e?.z ?? 7) === Number(playerZ ?? 7))
    .sort((a, b) => {
      const az = Number(a?.z ?? 7);
      const bz = Number(b?.z ?? 7);
      if (az !== bz) return az - bz;

      const astack = Number(
        a?.stackPosition ??
          calculateStackPosition(a?.flags ?? {}, a?.category ?? "creature"),
      );
      const bstack = Number(
        b?.stackPosition ??
          calculateStackPosition(b?.flags ?? {}, b?.category ?? "creature"),
      );
      if (astack !== bstack) return astack - bstack;

      const ay = Number(a?.y ?? 0);
      const by = Number(b?.y ?? 0);
      if (ay !== by) return by - ay;

      const ax = Number(a?.x ?? 0);
      const bx = Number(b?.x ?? 0);
      return ax - bx;
    });
}

export function prepareRenderList(
  entities,
  { playerZ, playerX, playerY, viewRadius = Infinity } = {},
) {
  const px = Number(playerX ?? 0);
  const py = Number(playerY ?? 0);
  const pz = Number(playerZ ?? 7);
  const radius = Number.isFinite(Number(viewRadius))
    ? Math.max(0, Number(viewRadius))
    : Infinity;

  return (entities ?? [])
    .filter((e) => {
      if (!e) return false;
      if (Number(e.z ?? 7) !== pz) return false;
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(radius)) {
        return true;
      }
      const dx = Math.abs(Number(e.x ?? 0) - px);
      const dy = Math.abs(Number(e.y ?? 0) - py);
      return dx <= radius && dy <= radius;
    })
    .map((e) => ({
      ...e,
      _stackPosition:
        e.stackPosition ??
        calculateStackPosition(e.flags ?? {}, e.category ?? "creature"),
      _renderKey: getRenderKey(e),
    }))
    .sort((a, b) => {
      if (a._renderKey < b._renderKey) return -1;
      if (a._renderKey > b._renderKey) return 1;
      return 0;
    });
}
