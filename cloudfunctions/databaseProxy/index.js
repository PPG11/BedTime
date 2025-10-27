const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const command = db.command

const ALLOWED_COLLECTIONS = new Set([
  'users',
  'checkins',
  'public_profiles',
  'goodnight_messages',
  'friend_invites'
])

const USER_ALLOWED_FIELDS = new Set([
  'uid',
  'nickname',
  'tzOffset',
  'targetHM',
  'buddyConsent',
  'buddyList',
  'incomingRequests',
  'outgoingRequests',
  'createdAt',
  'updatedAt'
])

const CHECKIN_ALLOWED_FIELDS = new Set([
  'uid',
  'userUid',
  'date',
  'status',
  'tzOffset',
  'ts',
  'goodnightMessageId',
  'message'
])

const PUBLIC_PROFILE_FIELDS = new Set([
  'uid',
  'nickname',
  'sleeptime',
  'streak',
  'todayStatus',
  'updatedAt'
])

const GOODNIGHT_MESSAGE_FIELDS = new Set([
  'uid',
  'content',
  'likes',
  'dislikes',
  'date',
  'createdAt'
])

const GOODNIGHT_VOTE_FIELDS = new Set(['likes', 'dislikes'])

const FRIEND_INVITE_FIELDS = new Set([
  'senderUid',
  'senderOpenId',
  'recipientUid',
  'recipientOpenId',
  'status',
  'createdAt',
  'updatedAt'
])

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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isDocumentNotFoundError(error) {
  if (!error) {
    return false
  }

  if (typeof error === 'string') {
    return /not\s*found/i.test(error)
  }

  if (typeof error === 'object') {
    const maybeError = error
    const pieces = []
    if (typeof maybeError.errMsg === 'string') {
      pieces.push(maybeError.errMsg)
    }
    if (typeof maybeError.message === 'string') {
      pieces.push(maybeError.message)
    }
    const text = pieces.join(' ')
    if (text) {
      return /not\s*found/i.test(text) || /cannot\s*find\s*document/i.test(text)
    }
  }

  return false
}

function sanitizePayload(data, allowedKeys) {
  if (!isPlainObject(data)) {
    throw new Error('数据格式无效，期待对象类型')
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`不允许写入字段: ${key}`)
    }
    if (value !== undefined) {
      sanitized[key] = value
    }
  }
  return sanitized
}

function ensureAllowedCollection(collection) {
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    throw new Error(`未支持的集合访问: ${collection}`)
  }
}

function parseFriendInviteId(id) {
  if (!isNonEmptyString(id)) {
    return null
  }
  const match = /^invite_([^_]+)_([^_]+)$/.exec(id)
  if (!match) {
    return null
  }
  return {
    senderUid: match[1],
    recipientUid: match[2]
  }
}

function queryHasValue(query, key, expected) {
  if (!isPlainObject(query) || !isNonEmptyString(expected)) {
    return false
  }
  const value = query[key]
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value) === expected
  }
  if (Array.isArray(value)) {
    return value.some((item) => String(item) === expected)
  }
  return false
}

function createAccessGuard(db, openid) {
  let userCachePromise = null

  async function fetchUserRecord() {
    if (!userCachePromise) {
      userCachePromise = (async () => {
        try {
          const snapshot = await db.collection('users').doc(openid).get()
          if (snapshot && snapshot.data) {
            const uid = isNonEmptyString(snapshot.data.uid) ? snapshot.data.uid : ''
            return { exists: true, uid }
          }
          return { exists: false, uid: '' }
        } catch (error) {
          if (isDocumentNotFoundError(error)) {
            return { exists: false, uid: '' }
          }
          throw error
        }
      })()
    }
    return userCachePromise
  }

  async function requireUserUid() {
    const record = await fetchUserRecord()
    if (record.exists && isNonEmptyString(record.uid)) {
      return record.uid
    }
    throw new Error('未找到当前用户信息，请先完成账户初始化')
  }

  async function ensureCheckinDocAccess(docId) {
    const userUid = await requireUserUid()
    if (!isNonEmptyString(docId)) {
      throw new Error('缺少文档 ID')
    }
    if (docId.startsWith(`${userUid}_`)) {
      return { userUid }
    }

    try {
      const snapshot = await db.collection('checkins').doc(docId).get()
      const data = snapshot?.data
      if (!data) {
        throw new Error('打卡记录不存在')
      }
      const ownerUid = isNonEmptyString(data.userUid)
        ? data.userUid
        : isNonEmptyString(data.uid)
        ? data.uid.split('_')[0]
        : ''
      const ownerDocUid = isNonEmptyString(data.uid) ? data.uid : ''
      const ownerOpenid = isNonEmptyString(data._openid) ? data._openid : ''
      if (
        ownerUid === userUid ||
        (ownerDocUid && ownerDocUid.startsWith(`${userUid}_`)) ||
        ownerOpenid === openid
      ) {
        return { userUid }
      }
    } catch (error) {
      if (isDocumentNotFoundError(error)) {
        throw new Error('无权访问打卡记录')
      }
      throw error
    }

    throw new Error('无权访问打卡记录')
  }

  async function ensureInviteOwnership(docId) {
    const userUid = await requireUserUid()
    const parsed = parseFriendInviteId(docId)
    if (!parsed) {
      throw new Error('非法的好友邀请编号')
    }
    const isSender = parsed.senderUid === userUid
    const isRecipient = parsed.recipientUid === userUid
    if (!isSender && !isRecipient) {
      throw new Error('无权访问该好友邀请')
    }
    return {
      userUid,
      isSender,
      isRecipient,
      senderUid: parsed.senderUid,
      recipientUid: parsed.recipientUid
    }
  }

  return {
    async prepareDocGet(event) {
      const { collection, id } = event
      ensureAllowedCollection(collection)
      if (!isNonEmptyString(id)) {
        throw new Error('缺少文档 ID')
      }

      switch (collection) {
        case 'users': {
          if (id !== openid) {
            throw new Error('无权读取其他用户的信息')
          }
          return { collection, id }
        }
        case 'checkins': {
          await ensureCheckinDocAccess(id)
          return { collection, id }
        }
        case 'public_profiles':
        case 'goodnight_messages':
          return { collection, id }
        case 'friend_invites': {
          await ensureInviteOwnership(id)
          return { collection, id }
        }
        default:
          throw new Error(`未支持的集合访问: ${collection}`)
      }
    },

    async prepareDocSet(event) {
      const { collection, id } = event
      ensureAllowedCollection(collection)
      if (!isNonEmptyString(id)) {
        throw new Error('缺少文档 ID')
      }
      const data = sanitizePayload(event.data || {},
        collection === 'users'
          ? USER_ALLOWED_FIELDS
          : collection === 'checkins'
          ? CHECKIN_ALLOWED_FIELDS
          : collection === 'public_profiles'
          ? PUBLIC_PROFILE_FIELDS
          : collection === 'goodnight_messages'
          ? GOODNIGHT_MESSAGE_FIELDS
          : FRIEND_INVITE_FIELDS)

      switch (collection) {
        case 'users': {
          if (id !== openid) {
            throw new Error('无权写入其他用户信息')
          }
          if (!isNonEmptyString(data.uid)) {
            throw new Error('缺少用户 UID')
          }
          const existing = await fetchUserRecord()
          if (existing.exists && isNonEmptyString(existing.uid) && data.uid !== existing.uid) {
            throw new Error('禁止修改已有用户的 UID')
          }
          return { collection, id, data }
        }
        case 'checkins': {
          const { userUid } = await ensureCheckinDocAccess(id)
          if (data.uid !== undefined && data.uid !== id) {
            throw new Error('禁止修改打卡记录编号')
          }
          if (data.userUid !== undefined && data.userUid !== userUid) {
            throw new Error('禁止修改打卡记录所属用户')
          }
          return {
            collection,
            id,
            data: {
              ...data,
              uid: id,
              userUid,
              _openid: openid
            }
          }
        }
        case 'public_profiles': {
          const userUid = await requireUserUid()
          if (id !== userUid) {
            throw new Error('无权写入其他用户的公开资料')
          }
          return {
            collection,
            id,
            data: {
              ...data,
              uid: userUid
            }
          }
        }
        case 'goodnight_messages': {
          const userUid = await requireUserUid()
          if (!id.startsWith(`${userUid}_`)) {
            throw new Error('无权写入其他用户的晚安留言')
          }
          if (data.uid !== undefined && data.uid !== userUid) {
            throw new Error('禁止修改晚安留言所属用户')
          }
          return {
            collection,
            id,
            data: {
              ...data,
              uid: userUid,
              _openid: openid
            }
          }
        }
        case 'friend_invites': {
          const { isSender, senderUid, recipientUid } = await ensureInviteOwnership(id)
          if (!isSender) {
            throw new Error('只有邀请发起者可以创建或覆盖邀请记录')
          }
          if (data.senderUid !== undefined && data.senderUid !== senderUid) {
            throw new Error('禁止修改好友邀请的发起者 UID')
          }
          if (data.recipientUid !== undefined && data.recipientUid !== recipientUid) {
            throw new Error('禁止修改好友邀请的接收者 UID')
          }
          if (data.status !== undefined) {
            const normalizedStatus = String(data.status).trim()
            if (!normalizedStatus.length) {
              throw new Error('好友邀请状态不能为空')
            }
            if (normalizedStatus !== 'pending') {
              throw new Error('好友邀请初始状态必须为待处理')
            }
            data.status = normalizedStatus
          }
          return {
            collection,
            id,
            data: {
              ...data,
              senderUid,
              recipientUid,
              senderOpenId: openid
            }
          }
        }
        default:
          throw new Error(`未支持的集合写入: ${collection}`)
      }
    },

    async prepareDocUpdate(event) {
      const { collection, id } = event
      ensureAllowedCollection(collection)
      if (!isNonEmptyString(id)) {
        throw new Error('缺少文档 ID')
      }
      const data = sanitizePayload(event.data || {},
        collection === 'users'
          ? USER_ALLOWED_FIELDS
          : collection === 'checkins'
          ? CHECKIN_ALLOWED_FIELDS
          : collection === 'public_profiles'
          ? PUBLIC_PROFILE_FIELDS
          : collection === 'goodnight_messages'
          ? GOODNIGHT_MESSAGE_FIELDS
          : FRIEND_INVITE_FIELDS)

      switch (collection) {
        case 'users': {
          if (id !== openid) {
            throw new Error('无权修改其他用户信息')
          }
          if (data.uid !== undefined) {
            const record = await fetchUserRecord()
            if (!isNonEmptyString(record.uid) || data.uid !== record.uid) {
              throw new Error('禁止修改用户 UID')
            }
            delete data.uid
          }
          if (data.createdAt !== undefined) {
            delete data.createdAt
          }
          return { collection, id, data }
        }
        case 'checkins': {
          const { userUid } = await ensureCheckinDocAccess(id)
          if (data.uid !== undefined && data.uid !== id) {
            throw new Error('禁止修改打卡记录编号')
          }
          if (data.userUid !== undefined && data.userUid !== userUid) {
            throw new Error('禁止修改打卡记录所属用户')
          }
          if (data.uid !== undefined) {
            data.uid = id
          }
          if (data.userUid !== undefined) {
            data.userUid = userUid
          }
          return { collection, id, data }
        }
        case 'public_profiles': {
          const userUid = await requireUserUid()
          if (id !== userUid) {
            throw new Error('无权修改其他用户的公开资料')
          }
          if (data.uid !== undefined && data.uid !== userUid) {
            throw new Error('禁止修改公开资料 UID')
          }
          delete data.uid
          return { collection, id, data }
        }
        case 'goodnight_messages': {
          const userUid = await requireUserUid()
          const isOwner = id.startsWith(`${userUid}_`)
          if (data.uid !== undefined && data.uid !== userUid) {
            throw new Error('禁止修改晚安留言所属用户')
          }
          if (!isOwner) {
            const keys = Object.keys(data)
            if (keys.length === 0) {
              throw new Error('缺少更新字段')
            }
            const illegal = keys.find((key) => !GOODNIGHT_VOTE_FIELDS.has(key))
            if (illegal) {
              throw new Error('只能更新晚安留言的点赞或点踩数量')
            }
            delete data.uid
            delete data.content
            delete data.date
            delete data.createdAt
          } else if (data.uid !== undefined) {
            data.uid = userUid
          }
          return { collection, id, data }
        }
        case 'friend_invites': {
          const { isSender, isRecipient, senderUid, recipientUid } = await ensureInviteOwnership(id)
          if (data.senderUid !== undefined && data.senderUid !== senderUid) {
            throw new Error('禁止修改好友邀请的发起者 UID')
          }
          if (data.recipientUid !== undefined && data.recipientUid !== recipientUid) {
            throw new Error('禁止修改好友邀请的接收者 UID')
          }
          if (!isSender && data.senderOpenId !== undefined) {
            throw new Error('无权修改好友邀请的发起者身份信息')
          }
          if (!isRecipient && data.recipientOpenId !== undefined) {
            throw new Error('无权修改好友邀请的接收者身份信息')
          }
          if (data.status !== undefined) {
            const normalizedStatus = String(data.status).trim()
            if (!normalizedStatus.length) {
              throw new Error('好友邀请状态不能为空')
            }
            const allowedStatuses = new Set(['pending', 'accept', 'accepted', 'declined'])
            if (!allowedStatuses.has(normalizedStatus)) {
              throw new Error('不支持的好友邀请状态更新')
            }
            if (!isRecipient && normalizedStatus !== 'pending') {
              throw new Error('只有邀请接收者可以更新好友邀请状态')
            }
            data.status = normalizedStatus
          }
          if (isSender) {
            if (data.senderOpenId !== undefined && data.senderOpenId !== openid) {
              throw new Error('发起者身份信息不匹配')
            }
            data.senderOpenId = openid
          }
          if (isRecipient) {
            if (data.recipientOpenId !== undefined && data.recipientOpenId !== openid) {
              throw new Error('接收者身份信息不匹配')
            }
            if (data.status !== undefined || data.recipientOpenId !== undefined) {
              data.recipientOpenId = openid
            }
          }
          return { collection, id, data }
        }
        default:
          throw new Error(`未支持的集合更新: ${collection}`)
      }
    },

    async prepareDocRemove(event) {
      const { collection, id } = event
      ensureAllowedCollection(collection)
      if (!isNonEmptyString(id)) {
        throw new Error('缺少文档 ID')
      }

      switch (collection) {
        case 'checkins':
          await ensureCheckinDocAccess(id)
          return { collection, id }
        case 'friend_invites':
          await ensureInviteOwnership(id)
          return { collection, id }
        default:
          throw new Error(`未支持的删除操作: ${collection}`)
      }
    },

    async prepareCollectionGet(event) {
      const { collection } = event
      ensureAllowedCollection(collection)
      const query = isPlainObject(event.query) ? event.query : {}

      switch (collection) {
        case 'users': {
          if (!queryHasValue(query, '_openid', openid)) {
            throw new Error('无权查询其他用户信息')
          }
          return { ...event, query }
        }
        case 'checkins': {
          const userUid = await requireUserUid()
          if (
            queryHasValue(query, '_openid', openid) ||
            queryHasValue(query, 'userUid', userUid) ||
            queryHasValue(query, 'uid', userUid)
          ) {
            return { ...event, query }
          }
          throw new Error('无权查询其他用户的打卡记录')
        }
        case 'friend_invites': {
          const userUid = await requireUserUid()
          if (
            queryHasValue(query, 'senderUid', userUid) ||
            queryHasValue(query, 'recipientUid', userUid)
          ) {
            return { ...event, query }
          }
          throw new Error('无权查询其他用户的好友邀请')
        }
        case 'public_profiles':
        case 'goodnight_messages':
          return { ...event, query }
        default:
          throw new Error(`未支持的集合查询: ${collection}`)
      }
    },

    async prepareCollectionCount(event) {
      const { collection } = event
      ensureAllowedCollection(collection)
      const query = isPlainObject(event.query) ? event.query : {}

      switch (collection) {
        case 'users': {
          if (queryHasValue(query, '_openid', openid)) {
            return { ...event, query }
          }
          const candidate = query.uid
          if (
            typeof candidate === 'string' ||
            typeof candidate === 'number'
          ) {
            return { ...event, query }
          }
          throw new Error('无权执行该用户统计查询')
        }
        case 'friend_invites': {
          const userUid = await requireUserUid()
          if (
            queryHasValue(query, 'senderUid', userUid) ||
            queryHasValue(query, 'recipientUid', userUid)
          ) {
            return { ...event, query }
          }
          throw new Error('无权统计其他用户的好友邀请')
        }
        case 'checkins': {
          if (queryHasValue(query, '_openid', openid)) {
            return { ...event, query }
          }
          throw new Error('无权统计其他用户的打卡记录')
        }
        case 'public_profiles':
        case 'goodnight_messages':
          return { ...event, query }
        default:
          throw new Error(`未支持的统计操作: ${collection}`)
      }
    }
  }
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

  const { OPENID } = cloud.getWXContext()
  if (!isNonEmptyString(OPENID)) {
    return {
      ok: false,
      error: {
        message: '无法识别用户身份'
      }
    }
  }

  const guard = createAccessGuard(db, OPENID)

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
        const params = await guard.prepareDocGet({ collection, id })
        const result = await db.collection(params.collection).doc(params.id).get()
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
        const params = await guard.prepareDocSet({ collection, id, data })
        await db
          .collection(params.collection)
          .doc(params.id)
          .set({
            data: convertDataPayload(params.data || {})
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
        const params = await guard.prepareDocUpdate({ collection, id, data })
        await db
          .collection(params.collection)
          .doc(params.id)
          .update({
            data: convertDataPayload(params.data || {})
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
        const params = await guard.prepareDocRemove({ collection, id })
        await db.collection(params.collection).doc(params.id).remove()
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
        const params = await guard.prepareCollectionGet({
          collection,
          query,
          orderBy,
          limit
        })
        let ref = db.collection(params.collection)
        if (params.query && Object.keys(params.query).length) {
          ref = ref.where(convertValue(params.query))
        }
        if (Array.isArray(params.orderBy)) {
          for (const rule of params.orderBy) {
            if (
              rule &&
              typeof rule.field === 'string' &&
              (rule.order === 'asc' || rule.order === 'desc')
            ) {
              ref = ref.orderBy(rule.field, rule.order)
            }
          }
        }
        if (
          typeof params.limit === 'number' &&
          Number.isFinite(params.limit) &&
          params.limit > 0
        ) {
          ref = ref.limit(Math.floor(params.limit))
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
        const params = await guard.prepareCollectionCount({ collection, query })
        let ref = db.collection(params.collection)
        if (params.query && Object.keys(params.query).length) {
          ref = ref.where(convertValue(params.query))
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
