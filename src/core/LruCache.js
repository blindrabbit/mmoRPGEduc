// =============================================================================
// LruCache.js — Cache LRU (Least Recently Used) com Limite
// =============================================================================
// Arquitetura:
//   - Remove automaticamente entradas antigas quando atinge limite
//   - Baseado em Map (ordem de inserção preservada)
//   - API compatível com Map (get, set, has, delete, clear)
//   - Previne memory leak em caches de render, pathfinding, etc.
// =============================================================================

/**
 * Cria um cache LRU com limite máximo de entradas.
 * @param {number} maxSize - Número máximo de entradas no cache
 * @returns {Object} Cache com API similar a Map
 *
 * @example
 * const cache = createLruCache(1000);
 * cache.set('key', 'value');
 * const value = cache.get('key');
 * if (cache.has('key')) { ... }
 */
export function createLruCache(maxSize = 1000) {
  if (maxSize < 1) {
    throw new Error("maxSize deve ser >= 1");
  }

  const map = new Map();

  return {
    /**
     * Obtém valor do cache.
     * @param {any} key
     * @returns {any} Valor ou undefined
     */
    get(key) {
      return map.get(key);
    },

    /**
     * Define valor no cache.
     * Remove entrada mais antiga se atingir limite.
     * @param {any} key
     * @param {any} value
     */
    set(key, value) {
      // Se a chave já existe, atualiza o valor
      if (map.has(key)) {
        map.set(key, value);
        return this;
      }

      // Remove entrada mais antiga se necessário
      while (map.size >= maxSize) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
      }

      map.set(key, value);
      return this;
    },

    /**
     * Verifica se chave existe no cache.
     * @param {any} key
     * @returns {boolean}
     */
    has(key) {
      return map.has(key);
    },

    /**
     * Remove entrada do cache.
     * @param {any} key
     * @returns {boolean}
     */
    delete(key) {
      return map.delete(key);
    },

    /**
     * Limpa todo o cache.
     */
    clear() {
      map.clear();
    },

    /**
     * Obtém número de entradas no cache.
     * @returns {number}
     */
    get size() {
      return map.size;
    },

    /**
     * Obtém tamanho máximo do cache.
     * @returns {number}
     */
    get maxSize() {
      return maxSize;
    },

    /**
     * Itera sobre entradas (para debug).
     * @returns {IterableIterator<[any, any]>}
     */
    entries() {
      return map.entries();
    },

    /**
     * Itera sobre chaves (para debug).
     * @returns {IterableIterator<any>}
     */
    keys() {
      return map.keys();
    },

    /**
     * Itera sobre valores (para debug).
     * @returns {IterableIterator<any>}
     */
    values() {
      return map.values();
    },

    /**
     * Executa callback para cada entrada (para debug).
     * @param {Function} callback
     */
    forEach(callback) {
      map.forEach(callback);
    },

    /**
     * Exporta estatísticas do cache.
     * @returns {{ size: number, maxSize: number, utilization: number }}
     */
    getStats() {
      return {
        size: map.size,
        maxSize,
        utilization: map.size / maxSize,
      };
    },
  };
}

// =============================================================================
// CLASSE LRUCACHE (API Orientada a Objetos)
// =============================================================================

/**
 * Classe LruCache com API completa.
 */
export class LruCache {
  /**
   * @param {number} maxSize - Número máximo de entradas
   */
  constructor(maxSize = 1000) {
    if (maxSize < 1) {
      throw new Error("maxSize deve ser >= 1");
    }

    this._map = new Map();
    this._maxSize = maxSize;
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Obtém valor do cache.
   * @param {any} key
   * @returns {any}
   */
  get(key) {
    const value = this._map.get(key);
    if (value !== undefined) {
      this._hits++;
      // Move para o final (mais recente)
      this._map.delete(key);
      this._map.set(key, value);
    } else {
      this._misses++;
    }
    return value;
  }

  /**
   * Define valor no cache.
   * @param {any} key
   * @param {any} value
   * @returns {this}
   */
  set(key, value) {
    // Se já existe, move para o final
    if (this._map.has(key)) {
      this._map.delete(key);
    } else {
      // Remove mais antigo se necessário
      while (this._map.size >= this._maxSize) {
        const firstKey = this._map.keys().next().value;
        this._map.delete(firstKey);
      }
    }

    this._map.set(key, value);
    return this;
  }

  /**
   * Verifica se existe.
   * @param {any} key
   * @returns {boolean}
   */
  has(key) {
    return this._map.has(key);
  }

  /**
   * Remove entrada.
   * @param {any} key
   * @returns {boolean}
   */
  delete(key) {
    return this._map.delete(key);
  }

  /**
   * Limpa cache.
   */
  clear() {
    this._map.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Tamanho atual.
   * @returns {number}
   */
  get size() {
    return this._map.size;
  }

  /**
   * Tamanho máximo.
   * @returns {number}
   */
  get maxSize() {
    return this._maxSize;
  }

  /**
   * Taxa de acertos (hit rate).
   * @returns {number} 0.0 a 1.0
   */
  get hitRate() {
    const total = this._hits + this._misses;
    return total > 0 ? this._hits / total : 0;
  }

  /**
   * Estatísticas do cache.
   * @returns {{
   *   size: number,
   *   maxSize: number,
   *   utilization: number,
   *   hits: number,
   *   misses: number,
   *   hitRate: number
   * }}
   */
  getStats() {
    return {
      size: this._map.size,
      maxSize: this._maxSize,
      utilization: this._map.size / this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: this.hitRate,
    };
  }

  /**
   * Itera sobre entradas.
   * @returns {IterableIterator<[any, any]>}
   */
  entries() {
    return this._map.entries();
  }

  /**
   * Itera sobre chaves.
   * @returns {IterableIterator<any>}
   */
  keys() {
    return this._map.keys();
  }

  /**
   * Itera sobre valores.
   * @returns {IterableIterator<any>}
   */
  values() {
    return this._map.values();
  }

  /**
   * Executa callback para cada entrada.
   * @param {Function} callback
   */
  forEach(callback) {
    this._map.forEach(callback);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default createLruCache;
