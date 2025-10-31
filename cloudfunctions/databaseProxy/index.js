const { initCloud, getDb } = require('../common/cloud')
const { normalizeError } = require('../common/errors')

initCloud()

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function deserializeCommand(db, descriptor) {
  const command = db.command
  if (!descriptor || typeof descriptor !== 'object') {
    return descriptor
  }
  const kind = descriptor.kind
  switch (kind) {
    case 'comparison': {
      const operator = descriptor.operator
      if (typeof command[operator] === 'function') {
        return command[operator](deserializeValue(db, descriptor.value))
      }
      break
    }
    case 'in':
      if (typeof command.in === 'function' && Array.isArray(descriptor.values)) {
        return command.in(descriptor.values.map((item) => deserializeValue(db, item)))
      }
      break
    case 'logical':
      if (descriptor.operator === 'and' && typeof command.and === 'function' && Array.isArray(descriptor.operands)) {
        const operands = descriptor.operands.map((operand) => deserializeCommand(db, operand))
        return command.and(operands)
      }
      break
    default:
      break
  }
  return descriptor
}

function deserializeValue(db, value) {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => deserializeValue(db, item))
  }

  if (isPlainObject(value)) {
    const marker = value.__cloudType
    if (marker === 'serverDate') {
      return db.serverDate()
    }
    if (marker === 'date') {
      const source = value.value
      if (typeof source === 'number' || typeof source === 'string') {
        const parsed = new Date(source)
        if (!Number.isNaN(parsed.getTime())) {
          return parsed
        }
      }
      return new Date()
    }
    if (marker === 'command') {
      return deserializeCommand(db, value)
    }

    const result = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        continue
      }
      result[key] = deserializeValue(db, entry)
    }
    return result
  }

  return value
}

function deserializeRecord(db, record) {
  if (!isPlainObject(record)) {
    return {}
  }
  const result = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue
    }
    result[key] = deserializeValue(db, value)
  }
  return result
}

async function handleRequest(db, payload) {
  const collectionName = typeof payload.collection === 'string' ? payload.collection.trim() : ''
  if (!collectionName) {
    throw new Error('缺少集合名称')
  }

  const collection = db.collection(collectionName)

  switch (payload.action) {
    case 'doc.get': {
      const id = typeof payload.id === 'string' ? payload.id : ''
      if (!id) {
        throw new Error('缺少文档 ID')
      }
      const snapshot = await collection.doc(id).get()
      const data = snapshot && typeof snapshot === 'object' ? snapshot.data : undefined
      return { data }
    }
    case 'doc.set': {
      const id = typeof payload.id === 'string' ? payload.id : ''
      if (!id) {
        throw new Error('缺少文档 ID')
      }
      const data = deserializeRecord(db, payload.data)
      await collection.doc(id).set({ data })
      return { ok: true }
    }
    case 'doc.update': {
      const id = typeof payload.id === 'string' ? payload.id : ''
      if (!id) {
        throw new Error('缺少文档 ID')
      }
      const data = deserializeRecord(db, payload.data)
      await collection.doc(id).update({ data })
      return { ok: true }
    }
    case 'doc.remove': {
      const id = typeof payload.id === 'string' ? payload.id : ''
      if (!id) {
        throw new Error('缺少文档 ID')
      }
      await collection.doc(id).remove()
      return { ok: true }
    }
    case 'collection.get': {
      let queryRef = collection
      if (isPlainObject(payload.query) && Object.keys(payload.query).length > 0) {
        queryRef = queryRef.where(deserializeRecord(db, payload.query))
      }
      if (Array.isArray(payload.orderBy)) {
        for (const entry of payload.orderBy) {
          const field = entry && typeof entry.field === 'string' ? entry.field : ''
          const order = entry && (entry.order === 'asc' || entry.order === 'desc') ? entry.order : null
          if (field && order) {
            queryRef = queryRef.orderBy(field, order)
          }
        }
      }
      if (Number.isFinite(payload.limit) && payload.limit > 0) {
        queryRef = queryRef.limit(Math.trunc(payload.limit))
      }
      const snapshot = await queryRef.get()
      const data = snapshot && typeof snapshot === 'object' ? snapshot.data : undefined
      return { data }
    }
    case 'collection.count': {
      let queryRef = collection
      if (isPlainObject(payload.query) && Object.keys(payload.query).length > 0) {
        queryRef = queryRef.where(deserializeRecord(db, payload.query))
      }
      const result = await queryRef.count()
      const total = result && typeof result.total === 'number' ? result.total : 0
      return { total }
    }
    default:
      throw new Error('不支持的数据库操作')
  }
}

exports.main = async (event) => {
  const db = getDb()
  try {
    const payload = isPlainObject(event) ? event : {}
    const result = await handleRequest(db, payload)
    return { ok: true, result }
  } catch (error) {
    console.error('databaseProxy error', error)
    const normalized = normalizeError(error)
    return {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message
      }
    }
  }
}
