// ═══════════════════════════════════════════════════════════════
// firebaseSync.js — Coordenador UI dos botões de sincronização
// Usa db.js como única camada de acesso ao Firebase
// ═══════════════════════════════════════════════════════════════
import {
  setMap,
  setMapData,
  clearWorldForReload,
  markWorldReloading,
  markWorldReady,
  markWorldReloadError,
  previewSchemaMigration,
  runSchemaMigration,
} from "../../../core/db.js";

export class FirebaseSync {
  constructor(worldState, logger, assets) {
    this.worldState = worldState;
    this.logger = logger;
    this.assets = assets;
  }

  setupButtons() {
    const btnReload  = document.getElementById("btn-reload-world");
    const btnPreview = document.getElementById("btn-schema-preview");
    const btnRun     = document.getElementById("btn-schema-run");
    const statusEl   = document.getElementById("upload-status");

    if (btnReload)  btnReload.addEventListener("click",  () => this._reloadWorld(statusEl));
    if (btnPreview) btnPreview.addEventListener("click", () => this._schemaPreview(statusEl));
    if (btnRun)     btnRun.addEventListener("click",     () => this._schemaRun(statusEl));
  }

  // ── Recarregar Mundo ────────────────────────────────────────
  async _reloadWorld(statusEl) {
    const { map, mapData } = this.worldState;

    if (!map || !mapData) {
      this._setStatus(statusEl, "Erro: mapa não carregado na memória.", "error");
      return;
    }

    const tilesCount   = Object.keys(map).length;
    const mapDataCount = Object.keys(mapData).length;
    const reloadId     = Date.now();

    this._setStatus(statusEl, "Iniciando recarga...");
    this._setBusy(true);

    try {
      await markWorldReloading({ reloadId, reason: "manual-reload", by: "worldEngine" });
      await clearWorldForReload();

      this._setStatus(statusEl, `Enviando ${tilesCount} tiles...`);
      await setMap(map);

      this._setStatus(statusEl, `Enviando ${mapDataCount} metadados...`);
      await setMapData(mapData);

      await markWorldReady({ reloadId, tilesCount, mapDataCount });

      this._setStatus(
        statusEl,
        `Concluído: ${tilesCount} tiles, ${mapDataCount} itens.`,
        "ok",
      );
      this.logger?.ok?.(`[FirebaseSync] Mundo sincronizado: ${tilesCount} tiles`);
    } catch (e) {
      await markWorldReloadError(e.message, { reloadId }).catch(() => {});
      this._setStatus(statusEl, `Erro: ${e.message}`, "error");
      this.logger?.error?.("[FirebaseSync] Falha na recarga:", e);
    } finally {
      this._setBusy(false);
    }
  }

  // ── Preview Schema ───────────────────────────────────────────
  async _schemaPreview(statusEl) {
    this._setStatus(statusEl, "Analisando schema...");
    this._setBusy(true);
    try {
      const result = await previewSchemaMigration();
      const msg = [
        `Schema preview: ${result.totalChanged} registros a migrar`,
        `  players_data: ${result.changed.playersData}`,
        `  online_players: ${result.changed.onlinePlayers}`,
        `  monsters: ${result.changed.monsters}`,
        `  effects: ${result.changed.effects}`,
        `  fields: ${result.changed.fields}`,
      ].join("\n");
      this._setStatus(statusEl, msg, result.totalChanged > 0 ? "warn" : "ok");
      this.logger?.info?.("[FirebaseSync] " + msg);
    } catch (e) {
      this._setStatus(statusEl, `Erro: ${e.message}`, "error");
    } finally {
      this._setBusy(false);
    }
  }

  // ── Aplicar Schema ───────────────────────────────────────────
  async _schemaRun(statusEl) {
    this._setStatus(statusEl, "Aplicando migração de schema...");
    this._setBusy(true);
    try {
      const result = await runSchemaMigration({ dryRun: false });
      const msg = `Schema aplicado: ${result.totalChanged} registros atualizados.`;
      this._setStatus(statusEl, msg, "ok");
      this.logger?.ok?.("[FirebaseSync] " + msg);
    } catch (e) {
      this._setStatus(statusEl, `Erro: ${e.message}`, "error");
    } finally {
      this._setBusy(false);
    }
  }

  // ── Helpers UI ───────────────────────────────────────────────
  _setStatus(el, msg, type = "") {
    if (!el) return;
    el.textContent = msg;
    el.className = type ? `status-${type}` : "";
  }

  _setBusy(busy) {
    ["btn-reload-world", "btn-schema-preview", "btn-schema-run"].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = busy;
    });
  }
}
