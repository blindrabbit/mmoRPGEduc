// ═══════════════════════════════════════════════════════════════
// firebaseClient.js — Conexão e helpers do Firebase
// Responsabilidade: APENAS comunicação com o banco.
// REGRA: Nenhum outro arquivo importa este módulo — apenas db.js.
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  onChildAdded,
  onChildRemoved,
  onChildChanged,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-database.js";
import { firebaseConfig } from "./firebase.config.js";

export const app = initializeApp(firebaseConfig);
export const db  = getDatabase(app);

// ---------------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------------

/** Lê uma vez o valor de um path. */
export async function dbGet(path) {
  const snap = await get(ref(db, path));
  return snap.val();
}

// ---------------------------------------------------------------------------
// ESCRITA SIMPLES
// ---------------------------------------------------------------------------

/** Sobrescreve completamente um path. */
export function dbSet(path, data) {
  return set(ref(db, path), data);
}

/**
 * ✅ CORRIGIDO — Multi-path update.
 *
 * Aceita UM objeto cujas chaves são paths completos e os valores são os dados.
 * Isso permite atualizar múltiplos nós em uma única operação atômica.
 *
 * Uso correto (db.js):
 *   dbUpdate({
 *     'players_data/id123/stats': { hp: 80 },
 *     'online_players/id123/stats': { hp: 80 },
 *   });
 *
 * NÃO use dbUpdate(path, data) — use dbSet(path, data) para escrita simples.
 */
export function dbUpdate(updates) {
  return update(ref(db), updates);
}

/** Remove um path do banco. */
export function dbRemove(path) {
  return remove(ref(db, path));
}

// ---------------------------------------------------------------------------
// ESCUTA EM TEMPO REAL
// ---------------------------------------------------------------------------

/**
 * Escuta mudanças em tempo real em um path.
 * @returns {function} unsubscribe — chame para parar de escutar
 */
export function dbWatch(path, cb) {
  return onValue(ref(db, path), (snap) => cb(snap.val()));
}

/**
 * Escuta adições, remoções e alterações de filhos de um nó.
 * Ao contrário de dbWatch (snapshot completo), cada filho dispara
 * seu callback individualmente — ideal para coleções onde itens
 * chegam em sequência (efeitos de AOE, projéteis, etc.).
 *
 * @param {string} path
 * @param {{ onAdd, onRemove, onChange }} callbacks
 * @returns {function} unsubscribe — chame para parar todos os listeners
 */
export function dbWatchChildren(path, { onAdd, onRemove, onChange } = {}) {
  const r = ref(db, path);
  const unsubs = [];
  if (onAdd)    unsubs.push(onChildAdded(r,   (snap) => onAdd(snap.key,    snap.val())));
  if (onRemove) unsubs.push(onChildRemoved(r, (snap) => onRemove(snap.key)));
  if (onChange) unsubs.push(onChildChanged(r,  (snap) => onChange(snap.key, snap.val())));
  return () => unsubs.forEach(u => u());
}

// ---------------------------------------------------------------------------
// SYNC DE ENTIDADE (upsert / delete)
// ---------------------------------------------------------------------------

/**
 * Atualiza (data !== null) ou remove (data === null) um nó no Firebase.
 * @param {string} path  — caminho completo, ex: 'online_players/id123'
 * @param {object|null} data
 */
export function syncEntity(path, data) {
  return data !== null
    ? update(ref(db, path), data)
    : set(ref(db, path), null);
}

// ---------------------------------------------------------------------------
// RELÓGIO DO SERVIDOR
// ---------------------------------------------------------------------------

/**
 * Escuta o offset do servidor e chama cb(offsetMs) a cada sincronização.
 * @returns {function} unsubscribe
 */
export function dbWatchServerTime(onOffset) {
  return onValue(ref(db, "worldstate/serverTime"), (snap) => {
    if (snap.exists()) onOffset(Date.now() - snap.val());
  });
}

// ---------------------------------------------------------------------------
// PRESENÇA — onDisconnect + heartbeat
// ---------------------------------------------------------------------------

/**
 * Registra remoção automática do player no Firebase quando o WebSocket cair.
 * O servidor Firebase executa o hook mesmo em crash ou queda de rede.
 * Deve ser chamado logo após o player entrar no jogo.
 * @param {string} playerId
 */
export function registerPlayerDisconnect(playerId) {
  onDisconnect(ref(db, `online_players/${playerId}`)).remove();
}

/**
 * Atualiza o timestamp de presença do player.
 * Chame a cada ~30s para manter o player ativo.
 * O world-engine remove players sem heartbeat após STALE_THRESHOLD_MS.
 * @param {string} playerId
 */
export function dbTouchPresence(playerId) {
  return set(ref(db, `online_players/${playerId}/lastSeen`), Date.now());
}
