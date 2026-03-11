// =============================================================================
// ProgressionUI.js — mmoRPGEduc
// Cliente-side: UI de level up e distribuição de atributos
// =============================================================================

import { worldEvents, EVENT_TYPES } from "../../../core/events.js";
import { getWorldEngineInstance } from "../api/WorldEngineInterface.js";

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
  }

  init() {
    const unsubXp = worldEvents.subscribe(
      EVENT_TYPES.PROGRESSION_XP_GAIN,
      (e) => {
        this._handleXpGain(e);
      },
    );
    this._unsubs.push(unsubXp);

    const unsubLevel = worldEvents.subscribe(
      EVENT_TYPES.PROGRESSION_LEVEL_UP,
      (e) => {
        this._handleLevelUp(e);
      },
    );
    this._unsubs.push(unsubLevel);

    const unsubStat = worldEvents.subscribe(
      EVENT_TYPES.PROGRESSION_STAT_ALLOCATED,
      (e) => {
        this._handleStatAllocated(e);
      },
    );
    this._unsubs.push(unsubStat);

    // Configurar botões de distribuição
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

  _setupStatButtons() {
    const stats = ["FOR", "INT", "AGI", "VIT"];
    for (const stat of stats) {
      const btn = this.statButtons[stat];
      if (btn) {
        btn.addEventListener("click", async () => {
          await this.allocatePoint(stat);
        });
      }
    }
  }

  _handleXpGain(event) {
    // Atualizar barra de XP
    if (this.xpBarElement && this.xpTextElement) {
      // Precisa buscar dados atuais do jogador
      // Isso seria feito via subscription do WorldEngineInterface
      console.log(`+${event.xpGained} XP de ${event.source}`);
    }
  }

  _handleLevelUp(event) {
    // Mostrar modal de level up
    if (this.levelUpModal) {
      const levelNum = this.levelUpModal.querySelector(".level-number");
      const pointsGained = this.levelUpModal.querySelector(".points-gained");

      if (levelNum) levelNum.textContent = event.newLevel;
      if (pointsGained) pointsGained.textContent = event.pointsGained;

      this.levelUpModal.classList.add("visible");

      // Auto-fechar após 5s
      setTimeout(() => {
        this.levelUpModal.classList.remove("visible");
      }, 5000);
    }

    // Atualizar display de nível
    if (this.levelElement) {
      this.levelElement.textContent = `Level ${event.newLevel}`;
    }

    console.log(
      `🎉 LEVEL UP! Nível ${event.newLevel} (+${event.pointsGained} pontos)`,
    );
  }

  _handleStatAllocated(event) {
    // Atualizar display de pontos disponíveis
    if (this.statPointsElement) {
      this.statPointsElement.textContent = `Pontos: ${event.availablePoints}`;
    }

    // Atualizar valor do atributo
    if (this.statValues[event.statName]) {
      this.statValues[event.statName].textContent = event.newValue;
    }
  }

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

  updatePlayerStats(stats) {
    // Atualizar UI com stats atuais do jogador
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

    // Atualizar valores dos atributos
    if (stats.allocatedStats) {
      for (const stat of ["FOR", "INT", "AGI", "VIT"]) {
        if (this.statValues[stat]) {
          this.statValues[stat].textContent = stats.allocatedStats[stat] || 0;
        }
      }
    }
  }
}

export function createProgressionUI(options) {
  const ui = new ProgressionUI(options);
  ui.init();
  return ui;
}
