export type TimedCacheEntry<T> = {
  value: T
  expiresAt: number
}

export type TimedCache<T> = {
  get(key: string): T | undefined
  set(key: string, value: T): void
  delete(key: string | undefined): void
  clear(): void
  keys(): IterableIterator<string>
  getOrLoad(key: string, loader: () => Promise<T>): Promise<T>
}

export function createTimedCache<T>(ttl: number): TimedCache<T> {
  const store = new Map<string, TimedCacheEntry<T>>()
  const inflight = new Map<string, Promise<T>>()

  function get(key: string): T | undefined {
    const entry = store.get(key)
    if (!entry) {
      return undefined
    }
    if (entry.expiresAt <= Date.now()) {
      store.delete(key)
      return undefined
    }
    return entry.value
  }

  function set(key: string, value: T): void {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttl
    })
  }

  function remove(key: string | undefined): void {
    if (typeof key === 'string') {
      store.delete(key)
      inflight.delete(key)
      return
    }
    store.clear()
    inflight.clear()
  }

  async function getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = get(key)
    if (cached !== undefined) {
      return cached
    }

    const existing = inflight.get(key)
    if (existing) {
      return existing
    }

    const promise = loader()
      .then((value) => {
        set(key, value)
        inflight.delete(key)
        return value
      })
      .catch((error) => {
        inflight.delete(key)
        throw error
      })

    inflight.set(key, promise)
    return promise
  }

  return {
    get,
    set,
    delete: remove,
    clear: () => remove(undefined),
    keys: () => store.keys(),
    getOrLoad
  }
}
