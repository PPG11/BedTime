const { initCloud, getDb, getOpenId } = require('common/cloud')
const { createError, normalizeError } = require('common/errors')

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

function forbidden(message) {
  return createError('FORBIDDEN', message)
}

function toTrimmedString(value) {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`.trim()
  }
  return ''
}

async function ensureAuthUser(db, authState) {
  if (Object.prototype.hasOwnProperty.call(authState, 'user')) {
    return authState.user
  }

  try {
    const snapshot = await db.collection('users').doc(authState.openid).get()
    const data = snapshot && snapshot.data
    if (data && typeof data.uid === 'string' && data.uid.trim()) {
      const uid = data.uid.trim()
      authState.user = { uid }
      return authState.user
    }
  } catch (error) {
    const message = typeof error?.errMsg === 'string' ? error.errMsg : ''
    if (!/not exist|not found|fail/i.test(message)) {
      throw error
    }
  }

  authState.user = null
  return authState.user
}

async function ensureAuthUid(db, authState) {
  const user = await ensureAuthUser(db, authState)
  const uid = user && typeof user.uid === 'string' ? user.uid : ''
  if (!uid) {
    throw forbidden('当前用户尚未初始化')
  }
  return uid
}

function ensureAllowedFields(data, allowedFields) {
  if (!isPlainObject(data)) {
    throw forbidden('缺少有效的数据负载')
  }
  for (const key of Object.keys(data)) {
    if (!allowedFields.has(key)) {
      throw forbidden('包含不允许的字段')
    }
  }
}

async function authorizeOperation(db, collectionName, action, payload, authState) {
  const policies = {
    users: {
      actions: new Set(['doc.get', 'doc.set', 'doc.update', 'collection.get', 'collection.count']),
      async authorize() {
        if (action === 'doc.get' || action === 'doc.set' || action === 'doc.update') {
          const id = toTrimmedString(payload.id)
          if (!id || id !== authState.openid) {
            throw forbidden('不允许访问其他用户信息')
          }
          return
        }

        if (action === 'collection.get') {
          const query = isPlainObject(payload.query) ? payload.query : {}
          const keys = Object.keys(query)
          if (!keys.length) {
            throw forbidden('缺少查询条件')
          }
          const allowedKeys = ['_openid', '_id']
          for (const key of keys) {
            if (!allowedKeys.includes(key)) {
              throw forbidden('不允许的查询条件')
            }
          }
          const openidValue = toTrimmedString(query._openid)
          const idValue = toTrimmedString(query._id)
          if (openidValue && openidValue !== authState.openid) {
            throw forbidden('不允许访问其他用户信息')
          }
          if (idValue && idValue !== authState.openid) {
            throw forbidden('不允许访问其他用户信息')
          }
          if (!openidValue && !idValue) {
            throw forbidden('缺少有效的查询条件')
          }
          return
        }

        if (action === 'collection.count') {
          const query = isPlainObject(payload.query) ? payload.query : {}
          const keys = Object.keys(query)
          if (keys.length !== 1 || keys[0] !== 'uid') {
            throw forbidden('不允许的计数条件')
          }
          const uidValue = toTrimmedString(query.uid)
          if (!uidValue) {
            throw forbidden('计数条件缺少 UID')
          }
          return
        }

        throw forbidden('不允许的数据库操作')
      }
    },
    checkins: {
      actions: new Set(['doc.get', 'doc.set', 'doc.update', 'collection.get', 'collection.count']),
      async authorize() {
        const uid = await ensureAuthUid(db, authState)

        if (action === 'doc.get' || action === 'doc.set' || action === 'doc.update') {
          const id = toTrimmedString(payload.id)
          if (!id || id !== uid) {
            throw forbidden('不允许访问其他用户的打卡记录')
          }
          return
        }

        if (action === 'collection.get' || action === 'collection.count') {
          const query = isPlainObject(payload.query) ? payload.query : {}
          const queryUid = toTrimmedString(query.uid)
          if (!queryUid || queryUid !== uid) {
            throw forbidden('查询条件缺少当前用户 UID')
          }
          return
        }

        throw forbidden('不允许的数据库操作')
      }
    },
    public_profiles: {
      actions: new Set(['doc.get', 'doc.set', 'doc.update', 'collection.get']),
      async authorize() {
        if (action === 'doc.get' || action === 'collection.get') {
          return
        }

        const uid = await ensureAuthUid(db, authState)
        const id = toTrimmedString(payload.id)
        if (!id || id !== uid) {
          throw forbidden('不允许修改其他用户的公开资料')
        }
        const data = isPlainObject(payload.data) ? payload.data : {}
        const dataUid = toTrimmedString(data.uid)
        if (dataUid && dataUid !== uid) {
          throw forbidden('公开资料 UID 不匹配')
        }
        return
      }
    },
    goodnight_messages: {
      actions: new Set(['doc.get', 'doc.set', 'doc.update', 'collection.get']),
      async authorize() {
        if (action === 'doc.get' || action === 'collection.get') {
          return
        }

        const uid = await ensureAuthUid(db, authState)

        if (action === 'doc.set') {
          const id = toTrimmedString(payload.id)
          if (!id || !id.startsWith(`${uid}_`)) {
            throw forbidden('不允许为其他用户创建晚安留言')
          }
          const data = isPlainObject(payload.data) ? payload.data : {}
          const dataUid = toTrimmedString(data.uid)
          if (dataUid && dataUid !== uid) {
            throw forbidden('晚安留言 UID 不匹配')
          }
          return
        }

        if (action === 'doc.update') {
          const data = isPlainObject(payload.data) ? payload.data : {}
          ensureAllowedFields(data, new Set(['likes', 'dislikes']))
          return
        }

        throw forbidden('不允许的数据库操作')
      }
    }
  }

  const policy = policies[collectionName]
  if (!policy) {
    throw forbidden('不允许访问指定集合')
  }
  if (!policy.actions.has(action)) {
    throw forbidden('不允许的数据库操作')
  }

  await policy.authorize()
}

async function handleRequest(db, payload, authState) {
  const collectionName = typeof payload.collection === 'string' ? payload.collection.trim() : ''
  if (!collectionName) {
    throw new Error('缺少集合名称')
  }

  const action = typeof payload.action === 'string' ? payload.action : ''
  if (!action) {
    throw new Error('缺少数据库操作')
  }

  await authorizeOperation(db, collectionName, action, payload, authState)

  const collection = db.collection(collectionName)

  switch (action) {
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
      // 对于晚安心语集合，确保默认设置 status: 'approved' 和 rand 字段
      if (collectionName === 'goodnight_messages') {
        data.status = 'approved'
        // 如果客户端没有提供 rand 字段，自动生成一个 0-1 之间的随机数
        if (typeof data.rand !== 'number' || !Number.isFinite(data.rand)) {
          data.rand = Math.random()
        }
      }
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

exports.main = async (event, context) => {
  const db = getDb()
  try {
    const openid = getOpenId(context)
    if (!openid) {
      throw createError('UNAUTHORIZED', '缺少 OPENID')
    }
    const payload = isPlainObject(event) ? event : {}
    const authState = { openid }
    const result = await handleRequest(db, payload, authState)
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
