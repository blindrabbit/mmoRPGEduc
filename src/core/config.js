// ═══════════════════════════════════════════════════════════════════════════
// config.js — Fonte única de verdade para todas as constantes do projeto.
// Regra: NENHUM arquivo do projeto define valores fixos localmente.
//        Tudo vem daqui.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// config.js — Configurações globais
// ═══════════════════════════════════════════════════════════════

// Configurações do World Engine
export const WORLDENGINE = {
  canvasCols: 30,
  canvasRows: 25,
  camSpeed: 2,
  roofFadeRadius: 3,
  worldTickMs: 250,
};

// Range de floors visíveis
export const FLOORRANGE = 0;

// Assets — LEGADO (para compatibilidade)
// export const ASSETS = {
//   basePath: './assets/',
//   mapFile: './assets/map_compacto.json',
//   dataFile: './assets/nexo_data.json',
//   atlasFile: './assets/nexo_atlas.png',
// };

// Assets — NOVO PIPELINE (prioritário)
export const NEW_ASSETS = {
  basePath: "./assets/",
  mapFile: "./assets/map_compacto.json",
  dataFile: "./assets/map_data.json",
  atlasFolder: "./assets/",
};

// Tile size
// export const TILE_SIZE = 32;

// Entity render config
// export const ENTITY_RENDER = {
//   offsetX: 0,
//   offsetY: 0,
//   footAnchorY: 1.0,
//   labelOffsetX: 0,
//   labelBarY: -8,
//   labelNameY: -12,
// };

// ───────────────────────────────────────────────────────────────────────────
// ASSETS — caminhos dos arquivos de dados (compartilhado por todas as telas)
// ───────────────────────────────────────────────────────────────────────────
export const ASSETS = {
  mapFile: "../assets/map_compacto.json",
  dataFile: "../assets/map_data.json",
  atlasFile: "../assets/mapa_atlas.png",
};

export const GAME_CONFIG = {
  tps: 60,
  maxPlayers: 50,
  firebaseSyncInterval: 30000,
};

// ───────────────────────────────────────────────────────────────────────────
// RENDER — constantes de tile e viewport
// ───────────────────────────────────────────────────────────────────────────
export const TILE_SIZE = 32; // px por SQM
export const VIEW_WIDTH = 960; // px
export const VIEW_HEIGHT = 640; // px
export const GROUND_Z = 7; // andar padrão do mundo
export const FLOOR_RANGE = 3; // andares visíveis acima/abaixo no floor HUD
export const GLOBALOFFSET = 0; // legado — não usado no pipeline principal

// ───────────────────────────────────────────────────────────────────────────
// EFFECTS_RENDER — offset global dos efeitos visuais, magias e cadáveres.
// Ajuste aqui para alinhar efeitos (fire wave, fields, corpses) com os tiles.
//
// ⚠️ CALIBRADO: valores atuais são considerados "ideais" para o projeto.
// Não alterar em novas atualizações sem uma rodada completa de verificação
// (admin.html + rpg.html + worldEngine.html) em múltiplos floors.
// ───────────────────────────────────────────────────────────────────────────
export const EFFECTS_RENDER = Object.freeze({
  offsetX: -16, // px — deslocamento horizontal do sprite do efeito
  offsetY: 0, // px — deslocamento vertical do sprite do efeito
  categories: Object.freeze({
    // Impactos de ataque (hit/miss): permite ajustar separado dos demais.
    attack: Object.freeze({
      offsetX: 0,
      offsetY: 0,
      snapToTile: true,
    }),
    // Fields persistentes no chão (fogo, veneno, etc.).
    field: Object.freeze({
      offsetX: 0,
      offsetY: 0,
      snapToTile: true,
    }),
    // Ondas/efeitos de área instantâneos (ex.: ids com sufixo wave).
    wave: Object.freeze({
      offsetX: 0,
      offsetY: 0,
      snapToTile: true,
    }),
    // Cadáveres.
    corpse: Object.freeze({
      offsetX: 0,
      offsetY: 0,
      snapToTile: true,
    }),
    // Fallback padrão para outros efeitos.
    generic: Object.freeze({
      offsetX: 0,
      offsetY: 0,
      snapToTile: false,
    }),
  }),
});

// ───────────────────────────────────────────────────────────────────────────
// ENTITY_RENDER — posicionamento global dos sprites de entidades no tile
// Ajuste aqui para alinhar pés/sombra de monstros, players e NPCs.
//
// ⚠️ CALIBRADO: valores atuais são considerados "ideais" para o projeto.
// Não alterar em novas atualizações sem validar alinhamento de player/monster
// e hover/picking no admin.
// ───────────────────────────────────────────────────────────────────────────
export const ENTITY_RENDER = Object.freeze({
  // Onde o "pé" cai no tile, como fração de TILE_SIZE.
  //   0.0 = topo do tile
  //   0.5 = centro do tile
  //   1.0 = borda inferior do tile
  footAnchorY: 1.5,
  footAnchorX: 1.5,

  // Deslocamento global do sprite em pixels.
  offsetX: -24,
  offsetY: -24,

  // ── Labels (barra de HP + nome) ─────────────────────────────────
  // Posições relativas ao TOPO VISUAL DO SPRITE (negativo = acima).
  // labelOffsetX: deslocamento horizontal extra a partir do centro do sprite.
  labelOffsetX: 0,
  // labelBarY: posição Y da barra de HP (ex: -6 = 6px acima do sprite).
  labelBarY: -12,
  // labelNameY: posição Y do texto do nome (deve ser < labelBarY).
  labelNameY: -16,
});

// ───────────────────────────────────────────────────────────────────────────
// MOVIMENTO
// ───────────────────────────────────────────────────────────────────────────
/** Tempo em ms para completar 1 SQM de caminhada */
export const WALK_SPEED = 200;

// ───────────────────────────────────────────────────────────────────────────
// MUNDO — spawn, morte, regras globais
// ───────────────────────────────────────────────────────────────────────────
export const WORLD_SETTINGS = {
  spawn: { x: 100, y: 100, z: 7 },
  camSpeed: 1.5,
  roofFadeRadius: 0,
  defaultCols: 32,
  defaultRows: 24,
  death: {
    hpRecoveryMultiplier: 1.0, // 1.0 = 100% de vida ao renascer
    clearStatusOnDeath: true,
    respawnDelayPlayer: 2000, // ms até o teleporte
  },
};

// ───────────────────────────────────────────────────────────────────────────
// CLASSES DE PERSONAGEM
// ───────────────────────────────────────────────────────────────────────────
export const PLAYER_CLASSES = {
  cavaleiro: {
    hp: 120,
    mp: 20,
    atk: 15,
    def: 8,
    agi: 5,
    speed: 110,
    color: "#95a5a6",
  },
  mago: {
    hp: 70,
    mp: 100,
    atk: 20,
    def: 3,
    agi: 8,
    speed: 120,
    color: "#9b59b6",
  },
  arqueiro: {
    hp: 90,
    mp: 40,
    atk: 18,
    def: 5,
    agi: 12,
    speed: 130,
    color: "#2ecc71",
  },
  druid: {
    hp: 100,
    mp: 80,
    atk: 10,
    def: 6,
    agi: 7,
    speed: 115,
    color: "#f1c40f",
  },
  clerigo: {
    hp: 100,
    mp: 80,
    atk: 10,
    def: 6,
    agi: 7,
    speed: 115,
    color: "#f1c40f",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// WORLD ENGINE — editor/servidor de mapa
// ───────────────────────────────────────────────────────────────────────────
export const WORLD_ENGINE = {
  canvasCols: 35, // SQMs visíveis na largura
  canvasRows: 25, // SQMs visíveis na altura
  roofFadeRadius: 0, // 0 = desativado (editor vê todos os floors)
  camSpeed: 1.0, // SQMs por frame
  worldTickMs: 250, // intervalo do world tick em ms
};

// ───────────────────────────────────────────────────────────────────────────
// RPG ENGINE — cliente do jogador
// ───────────────────────────────────────────────────────────────────────────
export const RPG_ENGINE = {
  canvasCols: 25, // SQMs visíveis (padrão Tibia)
  canvasRows: 20,
  roofFadeRadius: 3, // raio do fade de teto
  stepMs: 250, // ms entre passos do personagem
  spawnX: WORLD_SETTINGS.spawn.x,
  spawnY: WORLD_SETTINGS.spawn.y,
  spawnZ: WORLD_SETTINGS.spawn.z,
  defaultSpeed: 120,
};

// ───────────────────────────────────────────────────────────────────────────
// GM ENGINE — painel do mestre
// ───────────────────────────────────────────────────────────────────────────
export const GM_ENGINE = {
  canvasCols: 25,
  canvasRows: 20,
  roofFadeRadius: 0, // GM vê todos os floors
  camSpeed: 1.5,
};

// ───────────────────────────────────────────────────────────────────────────
// ADMIN ENGINE — editor de mapa (admin.html)
// O canvas do admin é dinâmico: ocupa a janela menos painéis laterais.
// ───────────────────────────────────────────────────────────────────────────
export const ADMIN_ENGINE = {
  sidebarWidth: 280, // px — largura do painel lateral esquerdo
  logPanelHeight: 200, // px — altura do painel de log inferior
  roofFadeRadius: 0, // admin vê todos os floors
  camSpeed: 1.0,
};

// ───────────────────────────────────────────────────────────────────────────
// REGENERAÇÃO — HP e MP recuperados por tick, por classe
// Tick padrão: 2000ms. Pode ser modificado via buff/item (regenTickMs).
// ───────────────────────────────────────────────────────────────────────────
export const REGEN_RATES = {
  cavaleiro: { hp: 15, mp: 5 },
  arqueiro: { hp: 10, mp: 10 },
  druid: { hp: 5, mp: 15 },
  mago: { hp: 5, mp: 15 },
  clerigo: { hp: 5, mp: 15 }, // alias de druid
  default: { hp: 5, mp: 5 }, // fallback para classes sem config
};

/** Intervalo base de regeneração em ms */
export const REGEN_TICK_MS = 2000;

// ═══════════════════════════════════════════════════════════════════════════
// ALIASES DE COMPATIBILIDADE
// Permitem que arquivos antigos continuem funcionando sem edição.
// Remova gradualmente à medida que os arquivos forem atualizados.
//
// Usado por:            Nome novo         → Nome antigo
//   admin.html          WORLD_SETTINGS    → WORLDSETTINGS
//   rpg.html            ASSETS            → ASSETS         (sem mudança)
//   rpg.html            RPG_ENGINE        → RPGCLIENT
//   mapRenderer.js      TILE_SIZE         → TILESIZE
//   mapRenderer.js      GROUND_Z          → GROUNDZ
//   worldEngine.html    WORLD_ENGINE      → WORLDENGINE
//   worldEngine.html    FLOOR_RANGE       → FLOORRANGE
//   playerManager.js    PLAYER_CLASSES    → PLAYERCLASSES
//   combatEngine.js     WORLD_SETTINGS    → WORLDSETTINGS
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated use WORLD_SETTINGS */
export const WORLDSETTINGS = WORLD_SETTINGS;

/** @deprecated use RPG_ENGINE */
export const RPGCLIENT = RPG_ENGINE;

/** @deprecated use TILE_SIZE */
// export const TILESIZE = TILE_SIZE;

/** @deprecated use GROUND_Z */
export const GROUNDZ = GROUND_Z;

/** @deprecated use FLOOR_RANGE */
// export const FLOORRANGE = FLOOR_RANGE;

/** @deprecated use WORLD_ENGINE */
// export const WORLDENGINE = WORLD_ENGINE;

/** @deprecated use PLAYER_CLASSES */
export const PLAYERCLASSES = PLAYER_CLASSES;

/** @deprecated use GM_ENGINE */
export const GMENGINE = GM_ENGINE;

/** @deprecated use ADMIN_ENGINE */
export const ADMINENGINE = ADMIN_ENGINE;
