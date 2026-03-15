// ═══════════════════════════════════════════════════════════════
// firebaseSync.js — Coordenador UI dos botões de sincronização
// Usa db.js como única camada de acesso ao Firebase
// ═══════════════════════════════════════════════════════════════
import {
  setMapChunks,
  setMapData,
  setMonsterTemplates,
  setEntitySchemas,
  setAbilitySchemas,
  clearWorldForReload,
  markWorldReloading,
  markWorldReady,
  markWorldReloadError,
  previewSchemaMigration,
  runSchemaMigration,
} from "../../../core/db.js";
import { NEW_ASSETS } from "../../../core/config.js";

export class FirebaseSync {
  constructor(worldState, logger, assets) {
    this.worldState = worldState;
    this.logger = logger;
    this.assets = assets;
  }

  async _fetchJsonNoCache(path, label) {
    const sep = String(path).includes("?") ? "&" : "?";
    const cacheBustedPath = `${path}${sep}_ts=${Date.now()}`;
    const res = await fetch(cacheBustedPath, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`${label} indisponivel (${res.status})`);
    }
    return await res.json();
  }

  async _loadFreshLocalWorldData(statusEl) {
    this._setStatus(
      statusEl,
      "Lendo map_compacto.json e map_data.json locais...",
    );

    const [freshMap, freshMapData] = await Promise.all([
      this._fetchJsonNoCache(NEW_ASSETS.mapFile, "map_compacto.json"),
      this._fetchJsonNoCache(NEW_ASSETS.dataFile, "map_data.json"),
    ]);

    if (!freshMap || typeof freshMap !== "object") {
      throw new Error("map_compacto.json invalido");
    }
    if (!freshMapData || typeof freshMapData !== "object") {
      throw new Error("map_data.json invalido");
    }

    this.worldState._localMap = freshMap;
    this.worldState.mapData = freshMapData;
    if (this.assets) this.assets.mapData = freshMapData;

    return {
      localMap: freshMap,
      mapData: freshMapData,
    };
  }

  setupButtons() {
    const btnReload = document.getElementById("btn-reload-world");
    const btnSyncModels = document.getElementById("btn-sync-models");
    const btnPreview = document.getElementById("btn-schema-preview");
    const btnRun = document.getElementById("btn-schema-run");
    const statusEl = document.getElementById("upload-status");

    if (btnReload)
      btnReload.addEventListener("click", () => this._reloadWorld(statusEl));
    if (btnSyncModels)
      btnSyncModels.addEventListener("click", () =>
        this._syncModelsOnly(statusEl),
      );
    if (btnPreview)
      btnPreview.addEventListener("click", () => this._schemaPreview(statusEl));
    if (btnRun)
      btnRun.addEventListener("click", () => this._schemaRun(statusEl));
  }

  async syncModelsAndSchemasFromLocal() {
    const [{ ENTITY_SCHEMAS, ABILITY_TYPE_SCHEMAS }, { MONSTER_TEMPLATES }] =
      await Promise.all([
        import("../../../gameplay/entitySchemas.js"),
        import("../../../gameplay/monsterData.js"),
      ]);

    await Promise.all([
      setEntitySchemas(ENTITY_SCHEMAS),
      setAbilitySchemas(ABILITY_TYPE_SCHEMAS),
      setMonsterTemplates(MONSTER_TEMPLATES),
    ]);
  }

  async _syncModelsOnly(statusEl) {
    this._setStatus(statusEl, "Publicando modelos/schemas locais...");
    this._setBusy(true);
    try {
      await this.syncModelsAndSchemasFromLocal();
      this._setStatus(
        statusEl,
        "Modelos/schemas publicados com sucesso.",
        "ok",
      );
      this.logger?.ok?.(
        "[FirebaseSync] Modelos/schemas publicados no Firebase.",
      );
    } catch (e) {
      this._setStatus(statusEl, `Erro: ${e.message}`, "error");
      this.logger?.error?.(
        "[FirebaseSync] Falha ao publicar modelos/schemas:",
        e,
      );
    } finally {
      this._setBusy(false);
    }
  }

  // ── Recarregar Mundo ────────────────────────────────────────
  async _reloadWorld(statusEl) {
    // Recarrega usando JSONs locais como fonte de verdade.
    let localMap;
    let mapData;
    try {
      const fresh = await this._loadFreshLocalWorldData(statusEl);
      localMap = fresh.localMap;
      mapData = fresh.mapData;
    } catch (e) {
      this._setStatus(
        statusEl,
        `Erro ao ler JSON local: ${e.message}`,
        "error",
      );
      this.logger?.error?.("[FirebaseSync] Falha ao reler arquivos locais:", e);
      return;
    }

    if (!localMap || !mapData) {
      this._setStatus(
        statusEl,
        "Erro: mapa não carregado na memória.",
        "error",
      );
      return;
    }

    const tilesCount = Object.keys(localMap).length;
    const mapDataCount = Object.keys(mapData).length;
    const map = localMap;
    const reloadId = Date.now();

    this._setStatus(statusEl, "Iniciando recarga...");
    this._setBusy(true);

    try {
      await markWorldReloading({
        reloadId,
        reason: "manual-reload",
        by: "worldEngine",
      });

      this._setStatus(
        statusEl,
        "Limpando map_data e world_tiles anteriores...",
      );
      await clearWorldForReload();

      this._setStatus(statusEl, `Enviando ${tilesCount} tiles em chunks...`);
      await setMapChunks(map, (done, total) => {
        this._setStatus(statusEl, `Enviando chunks: ${done}/${total}...`);
      });

      this._setStatus(statusEl, `Enviando ${mapDataCount} metadados...`);
      await setMapData(mapData);

      this._setStatus(statusEl, "Sincronizando schemas/modelos...");
      await this.syncModelsAndSchemasFromLocal();

      await markWorldReady({ reloadId, tilesCount, mapDataCount });

      this._setStatus(
        statusEl,
        `Concluído: ${tilesCount} tiles, ${mapDataCount} itens.`,
        "ok",
      );
      this.logger?.ok?.(
        `[FirebaseSync] Mundo sincronizado: ${tilesCount} tiles`,
      );
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
    [
      "btn-reload-world",
      "btn-sync-models",
      "btn-schema-preview",
      "btn-schema-run",
    ].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = busy;
    });
  }
}
