// remoteTemplates.js — mantém cópia local dos templates carregados do Firebase.
// Permite que renderizadores e outros módulos acessem dados de monstros
// sem depender diretamente de `monsterData.js` (que só existe no servidor).

export let monsterTemplates = {};

/**
 * Atualiza o conjunto de templates (normalmente chamado pelo watcher do db.js).
 * @param {object} obj 
 */
export function setMonsterTemplates(obj) {
  monsterTemplates = obj || {};
}

/**
 * Retorna os templates atualmente em memória.
 * @returns {object}
 */
export function getMonsterTemplates() {
  return monsterTemplates;
}

/**
 * Tenta adivinhar a espécie de um monstro a partir do seu nome exibido.
 * Útil quando o registro no Firebase não traz a propriedade 'species'.
 *
 * @param {string} name
 * @returns {string|null} chave da espécie ou null se nenhum achar
 */
export function inferSpeciesFromName(name) {
  if (!name) return null;
  for (const key in monsterTemplates) {
    if (monsterTemplates[key]?.name === name) return key;
  }
  return null;
}
