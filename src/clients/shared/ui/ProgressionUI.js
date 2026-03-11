// =============================================================================
// ProgressionUI.js — mmoRPGEduc
// Cliente-side: UI de level up e distribuição de atributos
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../../core/events.js";
import { getWorldEngineInstance } from "../api/WorldEngineInterface.js";
import {
  previewStatAllocation,
  getClassProgressionInfo,
} from "../../../gameplay/progression/progressionSystem.js";

const STAT_LABELS = { FOR: "Força", INT: "Inteligência", AGI: "Agilidade", VIT: "Vitalidade" };

export class ProgressionUI {
  constructor(options = {}) {
    this.xpBarElement = options.xpBarElement;
    this.xpTextElement = options.xpTextElement;
    this.levelElement = options.levelElement;
    this.statPointsElement = options.statPointsElement;
    this.levelUpModal = options.levelUpModal;
    this.statButtons = options.statButtons || {}; // { FOR: btn, INT: btn, AGI: btn, VIT: btn }
    this.statValues = options.statValues || {}; // { FOR: span, INT: span, AGI: span, VIT: span }
    this._unsubs = [];
    this._currentPlayerId = null;
    this._cachedPlayer = null; // jogador completo para preview
  }

  init() {
    const unsubXp = worldEvents.subscribe(
      EVENT_TYPES.PROGRESSION_XP_GAIN,
      (e) => this._handleXpGain(e),
    );
    this._unsubs.push(unsubXp);

    const unsubLevel = worldEvents.subscribe(
      EVENT_TYPES.PROGRESSION_LEVEL_UP,
      (e) => this._handleLevelUp(e),
    );
    this._unsubs.push(unsubLevel);

    const unsubStat = worldEvents.subscribe(
      EVENT_TYPES.PROGRESSION_STAT_ALLOCATED,
      (e) => this._handleStatAllocated(e),
    );
    this._unsubs.push(unsubStat);

    this._setupStatButtons();
  }

  destroy() {
    for (const unsub of this._unsubs) {
      if (typeof unsub === "function") unsub();
    }
    this._unsubs = [];
  }

  setCurrentPlayerId(playerId) {
    this._currentPlayerId = playerId;
  }

  /**
   * Atualiza o objeto completo do jogador (necessário para preview e tooltips).
   * Chame sempre que receber dados atualizados do jogador.
   * @param {Object} player - Objeto completo do jogador (com .class e .stats)
   */
  updatePlayerData(player) {
    this._cachedPlayer = player;
    this._refreshTooltips();
    this.updatePlayerStats(player.stats);
  }

  // ---------------------------------------------------------------------------
  // SETUP DE BOTÕES
  // ---------------------------------------------------------------------------

  _setupStatButtons() {
    const stats = ["FOR", "INT", "AGI", "VIT"];
    for (const stat of stats) {
      const btn = this.statButtons[stat];
      if (!btn) continue;

      btn.addEventListener("click", async () => {
        await this.allocatePoint(stat);
      });

      // Tooltip ao hover: mostra eficiência + preview de ganho
      btn.addEventListener("mouseenter", () => this._showTooltip(stat, btn));
      btn.addEventListener("mouseleave", () => this._hideTooltip(btn));
    }
  }

  _showTooltip(statName, btn) {
    if (!this._cachedPlayer) return;

    const classInfo = getClassProgressionInfo(this._cachedPlayer.class);
    const efficiency = classInfo?.manualEfficiency?.[statName] ?? 1.0;
    const preview = previewStatAllocation(this._cachedPlayer, statName, 1);

    const effLabel = efficiency >= 1.0
      ? `+${((efficiency - 1) * 100).toFixed(0)}% bônus`
      : `-${((1 - efficiency) * 100).toFixed(0)}% penalidade`;

    const lines = [
      `${STAT_LABELS[statName]} — eficiência: ${efficiency.toFixed(1)}x (${effLabel})`,
      `Atual: ${preview.currentTotal.toFixed(1)} → Novo: ${preview.newTotal.toFixed(1)} (+${preview.effectiveGain.toFixed(1)})`,
    ];

    if (preview.derived.spellPowerGain > 0) {
      lines.push(`Poder mágico: +${preview.derived.spellPowerGain.toFixed(1)}`);
    }
    if (preview.derived.hpGain > 0) {
      lines.push(`HP máx: +${preview.derived.hpGain}`);
    }
    if (preview.derived.critGain > 0) {
      lines.push(`Crítico: +${(preview.derived.critGain * 100).toFixed(2)}%`);
    }

    // Reutiliza title como fallback; substitua por tooltip customizado se desejar
    btn.title = lines.join("\n");

    // Se existir elemento de tooltip dedicado, preenche
    const tooltipEl = btn.querySelector(".stat-tooltip") || btn.nextElementSibling;
    if (tooltipEl && tooltipEl.classList.contains("stat-tooltip")) {
      tooltipEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
      tooltipEl.classList.add("visible");
    }
  }

  _hideTooltip(btn) {
    const tooltipEl = btn.querySelector(".stat-tooltip") || btn.nextElementSibling;
    if (tooltipEl && tooltipEl.classList.contains("stat-tooltip")) {
      tooltipEl.classList.remove("visible");
    }
  }

  _refreshTooltips() {
    // Atualiza os títulos dos botões sem precisar de hover
    for (const stat of ["FOR", "INT", "AGI", "VIT"]) {
      const btn = this.statButtons[stat];
      if (!btn || !this._cachedPlayer) continue;
      const classInfo = getClassProgressionInfo(this._cachedPlayer.class);
      const efficiency = classInfo?.manualEfficiency?.[stat] ?? 1.0;
      btn.dataset.efficiency = efficiency.toFixed(1);
    }
  }

  // ---------------------------------------------------------------------------
  // HANDLERS DE EVENTOS
  // ---------------------------------------------------------------------------

  _handleXpGain(event) {
    if (this.xpBarElement && this.xpTextElement) {
      console.log(`+${event.xpGained} XP de ${event.source}`);
    }
  }

  _handleLevelUp(event) {
    if (this.levelUpModal) {
      const levelNum = this.levelUpModal.querySelector(".level-number");
      const pointsGained = this.levelUpModal.querySelector(".points-gained");
      if (levelNum) levelNum.textContent = event.newLevel;
      if (pointsGained) pointsGained.textContent = event.pointsGained;
      this.levelUpModal.classList.add("visible");
      setTimeout(() => this.levelUpModal.classList.remove("visible"), 5000);
    }

    if (this.levelElement) {
      this.levelElement.textContent = `Level ${event.newLevel}`;
    }

    console.log(`🎉 LEVEL UP! Nível ${event.newLevel} (+${event.pointsGained} pontos)`);
  }

  _handleStatAllocated(event) {
    if (this.statPointsElement) {
      this.statPointsElement.textContent = `Pontos: ${event.availablePoints}`;
    }
    if (this.statValues[event.statName]) {
      this.statValues[event.statName].textContent = Math.floor(event.newValue);
    }
  }

  // ---------------------------------------------------------------------------
  // ALOCAÇÃO DE PONTOS
  // ---------------------------------------------------------------------------

  async allocatePoint(statName) {
    if (!this._currentPlayerId) {
      console.error("[ProgressionUI] Player ID não definido");
      return { success: false, error: "Player ID não definido" };
    }

    const engine = getWorldEngineInstance();
    const result = await engine.sendAction({
      type: "allocateStat",
      payload: {
        playerId: this._currentPlayerId,
        statName,
        amount: 1,
      },
    });

    if (result.success) {
      console.log(`✅ ${statName} aumentado para ${result.newValue}`);
    } else {
      console.error(`❌ Erro: ${result.error}`);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // ATUALIZAÇÃO DE UI
  // ---------------------------------------------------------------------------

  updatePlayerStats(stats) {
    if (this.levelElement && stats.level) {
      this.levelElement.textContent = `Level ${stats.level}`;
    }

    if (this.statPointsElement && stats.availableStatPoints !== undefined) {
      this.statPointsElement.textContent = `Pontos: ${stats.availableStatPoints}`;
    }

    if (this.xpBarElement && stats.xp !== undefined && stats.xpToNext) {
      const percent = (stats.xp / stats.xpToNext) * 100;
      this.xpBarElement.style.width = `${percent}%`;
    }

    if (this.xpTextElement && stats.xp !== undefined && stats.xpToNext) {
      this.xpTextElement.textContent = `${stats.xp} / ${stats.xpToNext} XP`;
    }

    // Mostra totalStats quando disponível, fallback para allocatedStats
    for (const stat of ["FOR", "INT", "AGI", "VIT"]) {
      if (!this.statValues[stat]) continue;
      const total = stats.totalStats?.[stat];
      const allocated = stats.allocatedStats?.[stat];
      if (total !== undefined) {
        this.statValues[stat].textContent = Math.floor(total);
      } else if (allocated !== undefined) {
        this.statValues[stat].textContent = allocated;
      }
    }
  }
}

export function createProgressionUI(options) {
  const ui = new ProgressionUI(options);
  ui.init();
  return ui;
}
