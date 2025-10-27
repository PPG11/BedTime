const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const command = db.command

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function convertValue(value) {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => convertValue(item))
  }

  if (isPlainObject(value)) {
    const marker = value.__cloudType
    if (marker === 'date') {
      const iso = value.value
      if (typeof iso === 'string' || typeof iso === 'number') {
        return new Date(iso)
      }
      return new Date()
    }
    if (marker === 'serverDate') {
      return db.serverDate()
    }
    if (marker === 'command') {
      return convertCommand(value)
    }

    const result = {}
    for (const [key, entry] of Object.entries(value)) {
      const converted = convertValue(entry)
      if (converted !== undefined) {
        result[key] = converted
      }
    }
    return result
  }

  return value
}

function convertCommand(descriptor) {
  if (!descriptor || descriptor.__cloudType !== 'command') {
    return descriptor
  }

  switch (descriptor.kind) {
    case 'comparison': {
      const operand = convertValue(descriptor.value)
      const operator = descriptor.operator
      if (operator === 'gte') {
        return command.gte(operand)
      }
      if (operator === 'lte') {
        return command.lte(operand)
      }
      throw new Error(`不支持的比较操作符: ${operator}`)
    }
    case 'in': {
      const values = Array.isArray(descriptor.values)
        ? descriptor.values.map((item) => convertValue(item))
        : []
      return command.in(values)
    }
    case 'logical': {
      if (descriptor.operator === 'and') {
        const operands = Array.isArray(descriptor.operands)
          ? descriptor.operands.map((operand) => convertCommand(operand)).filter(Boolean)
          : []
        return command.and(operands)
      }
      throw new Error(`不支持的逻辑操作符: ${descriptor.operator}`)
    }
    default:
      throw new Error(`未知的命令类型: ${descriptor.kind}`)
  }
}

function normalizeOutput(value) {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeOutput(item))
  }

  if (value instanceof Date) {
    return {
      __cloudType: 'date',
      value: value.toISOString()
    }
  }

  if (isPlainObject(value)) {
    const result = {}
    for (const [key, entry] of Object.entries(value)) {
      result[key] = normalizeOutput(entry)
    }
    return result
  }

  return value
}

function convertDataPayload(data) {
  const converted = convertValue(data)
  if (!isPlainObject(converted)) {
    return converted
  }
  const result = {}
  for (const [key, value] of Object.entries(converted)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

exports.main = async (event) => {
  const action = event && event.action

  if (!action) {
    return {
      ok: false,
      error: {
        message: '缺少操作类型(action)'
      }
    }
  }

  try {
    switch (action) {
      case 'doc.get': {
        const { collection, id } = event
        if (typeof collection !== 'string' || !collection.length) {
          throw new Error('缺少集合名称')
        }
        if (typeof id !== 'string' || !id.length) {
          throw new Error('缺少文档 ID')
        }
        const result = await db.collection(collection).doc(id).get()
        return {
          ok: true,
          result: {
            data: normalizeOutput(result.data)
          }
        }
      }
      case 'doc.set': {
        const { collection, id, data } = event
        if (typeof collection !== 'string' || !collection.length) {
          throw new Error('缺少集合名称')
        }
        if (typeof id !== 'string' || !id.length) {
          throw new Error('缺少文档 ID')
        }
        await db
          .collection(collection)
          .doc(id)
          .set({
            data: convertDataPayload(data || {})
          })
        return {
          ok: true,
          result: {}
        }
      }
      case 'doc.update': {
        const { collection, id, data } = event
        if (typeof collection !== 'string' || !collection.length) {
          throw new Error('缺少集合名称')
        }
        if (typeof id !== 'string' || !id.length) {
          throw new Error('缺少文档 ID')
        }
        await db
          .collection(collection)
          .doc(id)
          .update({
            data: convertDataPayload(data || {})
          })
        return {
          ok: true,
          result: {}
        }
      }
      case 'doc.remove': {
        const { collection, id } = event
        if (typeof collection !== 'string' || !collection.length) {
          throw new Error('缺少集合名称')
        }
        if (typeof id !== 'string' || !id.length) {
          throw new Error('缺少文档 ID')
        }
        await db.collection(collection).doc(id).remove()
        return {
          ok: true,
          result: {}
        }
      }
      case 'collection.get': {
        const { collection, query, orderBy, limit } = event
        if (typeof collection !== 'string' || !collection.length) {
          throw new Error('缺少集合名称')
        }
        let ref = db.collection(collection)
        if (query && Object.keys(query).length) {
          ref = ref.where(convertValue(query))
        }
        if (Array.isArray(orderBy)) {
          for (const rule of orderBy) {
            if (
              rule &&
              typeof rule.field === 'string' &&
              (rule.order === 'asc' || rule.order === 'desc')
            ) {
              ref = ref.orderBy(rule.field, rule.order)
            }
          }
        }
        if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
          ref = ref.limit(Math.floor(limit))
        }
        const result = await ref.get()
        return {
          ok: true,
          result: {
            data: normalizeOutput(result.data || [])
          }
        }
      }
      case 'collection.count': {
        const { collection, query } = event
        if (typeof collection !== 'string' || !collection.length) {
          throw new Error('缺少集合名称')
        }
        let ref = db.collection(collection)
        if (query && Object.keys(query).length) {
          ref = ref.where(convertValue(query))
        }
        const result = await ref.count()
        return {
          ok: true,
          result: {
            total: result.total
          }
        }
      }
      default:
        throw new Error(`未支持的操作类型: ${action}`)
    }
  } catch (error) {
    console.error('databaseProxy 执行失败', action, error)
    return {
      ok: false,
      error: {
        message: error.message || '数据库操作失败',
        code: error.code,
        stack: error.stack
      }
    }
  }
}
