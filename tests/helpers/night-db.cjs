// Optimistic transaction double: isolated snapshots, conflicts/retries, rollback,
// and lost acknowledgements. It is not a substitute for CloudBase integration.
function createNightDatabase() {
  let data = new Map(), revision = 0
  const controls = { failWrite: 0, loseAck: false, conflictOnce: false, beforeTransaction: null, onConflict: null }
  const key = (name, id) => `${name}/${id}`
  const fieldValue = (row, field) => field.split('.').reduce((value, key) => value?.[key], row)
  function connect(state, transactional) {
    let writes = 0
    return {
      command: { lt: value => ({ lt: value }) },
      collection(name) {
        let where = {}, sort = null, limit = Infinity, fields = null
        const collection = {
          where(value) { where = value; return this },
          orderBy(field, direction) { sort = [field, direction]; return this },
          limit(value) { limit = value; return this },
          field(value) { fields = value; return this },
          async get() {
            let rows = [...state()].filter(([k]) => k.startsWith(`${name}/`)).map(([k, value]) => ({ ...structuredClone(value), _id: k.slice(name.length + 1) }))
            rows = rows.filter(row => Object.entries(where).every(([key, value]) => typeof value === 'object' && value?.lt !== undefined ? fieldValue(row, key) < value.lt : fieldValue(row, key) === value))
            if (sort) rows.sort((a, b) => (fieldValue(a, sort[0]) < fieldValue(b, sort[0]) ? -1 : fieldValue(a, sort[0]) > fieldValue(b, sort[0]) ? 1 : 0) * (sort[1] === 'desc' ? -1 : 1))
            rows = rows.slice(0, limit)
            if (fields) rows = rows.map(row => Object.fromEntries(Object.keys(fields).filter(key => fields[key]).map(key => [key, row[key]])))
            return { data: rows }
          },
          doc(id) {
          const k = key(name, id)
          return {
            async get() { const row = state().get(k); return { data: row ? { ...structuredClone(row), _id: id } : null } },
            async set({ data: row }) {
              if (++writes === controls.failWrite) throw new Error('write interrupted')
              state().set(k, structuredClone(row)); if (!transactional) revision++
            },
            async update({ data: patch }) {
              if (++writes === controls.failWrite) throw new Error('write interrupted')
              if (!state().has(k)) throw new Error('missing update document')
              state().set(k, { ...state().get(k), ...structuredClone(patch) }); if (!transactional) revision++
            }
          }
          }
        }
        return collection
      }
    }
  }
  const db = connect(() => data, false)
  db.runTransaction = async operation => {
    if (controls.beforeTransaction) { const hook = controls.beforeTransaction; controls.beforeTransaction = null; await hook() }
    for (let attempt = 0; attempt < 10; attempt++) {
      const version = revision, next = structuredClone(data)
      const result = await operation(connect(() => next, true))
      if (controls.conflictOnce) { controls.conflictOnce = false; revision++; controls.onConflict?.() }
      if (version !== revision) continue
      data = next; revision++
      if (controls.loseAck) { controls.loseAck = false; throw new Error('commit acknowledgement lost') }
      return result
    }
    throw new Error('too many conflicts')
  }
  db.controls = controls
  db.inspect = (name, id) => structuredClone(data.get(key(name, id)))
  db.rows = name => [...data].filter(([k]) => k.startsWith(`${name}/`)).map(([, row]) => structuredClone(row))
  db.seed = (name, id, row) => { data.set(key(name, id), structuredClone(row)); revision++ }
  return db
}
module.exports = { createNightDatabase }
