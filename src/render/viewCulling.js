// ═══════════════════════════════════════════════════════════════
// viewCulling.js — Filtragem de entidades por viewport
//
// Evita processar/renderizar entidades fora do campo visível,
// reduzindo carga de CPU em mapas com muitos monstros.
// ═══════════════════════════════════════════════════════════════

export const VIEW_CONFIG = Object.freeze({
  /** Raio de entidades visíveis (tiles em cada direção). Tibia usa ~14. */
  radius: 14,
  /** Raio de pré-carregamento de sprites além do view principal. */
  preloadRadius: 16,
  /**
   * Dispara re-render completo se câmera moveu ≥ dirtyThreshold tiles.
   * Usado pela lógica de dirty-rect (não ativado por padrão).
   */
  dirtyThreshold: 2,
});

/**
 * Retorna true se a entidade está dentro do raio de visão do jogador/câmera.
 *
 * @param {{ x: number, y: number, z: number }} entity
 * @param {{ x: number, y: number, z: number }} observer  - posição da câmera/player
 * @param {typeof VIEW_CONFIG} [config]
 */
export function isEntityInViewport(entity, observer, config = VIEW_CONFIG) {
  if (Number(entity?.z ?? 7) !== Number(observer?.z ?? 7)) return false;
  const dx = Math.abs(Number(entity.x) - Number(observer.x));
  const dy = Math.abs(Number(entity.y) - Number(observer.y));
  return dx <= config.radius && dy <= config.radius;
}

/**
 * Retorna true se a câmera moveu o suficiente para exigir re-render completo.
 *
 * @param {{ x: number, y: number }} currentPos
 * @param {{ x: number, y: number }} lastPos
 * @param {typeof VIEW_CONFIG} [config]
 */
export function shouldReRender(currentPos, lastPos, config = VIEW_CONFIG) {
  return (
    Math.abs(currentPos.x - lastPos.x) >= config.dirtyThreshold ||
    Math.abs(currentPos.y - lastPos.y) >= config.dirtyThreshold
  );
}

/**
 * Filtra entidades dentro do raio de pré-carregamento.
 *
 * @param {Object[]} entities
 * @param {{ x: number, y: number, z: number }} observer
 * @param {typeof VIEW_CONFIG} [config]
 */
export function getPreloadEntities(entities, observer, config = VIEW_CONFIG) {
  const oz = Number(observer?.z ?? 7);
  const ox = Number(observer?.x ?? 0);
  const oy = Number(observer?.y ?? 0);
  const r = config.preloadRadius;
  return (entities ?? []).filter((e) => {
    if (Number(e?.z ?? 7) !== oz) return false;
    return Math.abs(Number(e.x) - ox) <= r && Math.abs(Number(e.y) - oy) <= r;
  });
}
