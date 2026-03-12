// =============================================================================
// dragPreviewMessages.js — mensagens padronizadas para preview de drag/drop
// =============================================================================

function _formatEquipSlot(slot) {
  if (!slot) return "EQUIP";
  return String(slot).toUpperCase();
}

export function buildDropPreviewMessage(evt = {}) {
  if (evt?.cleared || !evt?.zone) return "";

  if (evt.zone === "inventory") {
    if (evt.previewAction === "pickUp") {
      return "✅ Solte para pegar no inventário";
    }
    if (evt.dropSlot != null) {
      return `📦 Solte para mover ao slot ${Number(evt.dropSlot) + 1}`;
    }
    return "📦 Solte para mover no inventário";
  }

  if (evt.zone === "equipment") {
    if (evt.canEquip) {
      const slot = _formatEquipSlot(evt.dropEquipSlot);
      return `🛡 Solte para equipar em ${slot}`;
    }
    return "❌ Item não compatível com este slot";
  }

  if (evt.zone === "ground") {
    return evt.previewAction === "moveWorld"
      ? "↔ Solte para mover pilha no chão"
      : "⬇ Solte para largar no chão";
  }

  return "";
}

export const DRAG_PREVIEW_TEXT = Object.freeze({
  start: "Arraste para um destino válido",
  sent: "✅ Ação enviada",
  invalid: "❌ Destino inválido",
});
