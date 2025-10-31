const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeUid(value) {
  if (!isNonEmptyString(value)) {
    return ''
  }
  return value.trim()
}

function normalizeTimestamp(value) {
  if (!value) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  if (typeof value === 'object') {
    const candidate =
      value.value ?? value.time ?? value.$date ?? value.$numberLong ?? value.$numberDecimal
    if (candidate !== undefined) {
      return normalizeTimestamp(candidate)
    }
  }
  return null
}

function isDocumentNotFoundError(error) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const errMsg = typeof error.errMsg === 'string' ? error.errMsg.toLowerCase() : ''
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : errMsg
  if (!message) {
    return false
  }
  return (
    message.includes('document.get:fail') ||
    message.includes('not found') ||
    message.includes('does not exist')
  )
}

function mapDocumentSnapshot(doc, openid) {
  if (!doc || typeof doc !== 'object') {
    return null
  }
  const info = Array.isArray(doc.info) ? doc.info : []
  const createdAt = normalizeTimestamp(doc.createdAt) ?? new Date().toISOString()
  const updatedAt = normalizeTimestamp(doc.updatedAt) ?? createdAt
  const ownerOpenid = doc.ownerOpenid ?? doc._openid ?? openid
  const uid = typeof doc.uid === 'string' && doc.uid.trim().length ? doc.uid.trim() : String(doc._id || '')
  return {
    documentId: String(doc._id || ''),
    uid,
    ownerOpenid,
    info,
    createdAt,
    updatedAt
  }
}

async function ensureExistingDocument(collection, uid, openid) {
  const docRef = collection.doc(uid)
  try {
    const snapshot = await docRef.get()
    if (snapshot && snapshot.data) {
      return mapDocumentSnapshot(
        {
          _id: uid,
          ...snapshot.data
        },
        openid
      )
    }
  } catch (error) {
    if (!isDocumentNotFoundError(error)) {
      throw error
    }
  }
  return null
}

async function findDocumentByUid(collection, uid, openid) {
  const result = await collection
    .where({
      uid
    })
    .limit(1)
    .get()
  const existing = result?.data && result.data[0]
  if (!existing) {
    return null
  }

  const updates = {}
  if (!Array.isArray(existing.info)) {
    updates.info = []
  }
  if (!existing.ownerOpenid && openid) {
    updates.ownerOpenid = openid
  }
  if (!existing.createdAt) {
    updates.createdAt = db.serverDate()
  }
  updates.updatedAt = db.serverDate()

  if (Object.keys(updates).length) {
    await collection.doc(existing._id).update({
      data: updates
    })
  }

  return mapDocumentSnapshot(existing, openid)
}

exports.main = async (event) => {
  try {
    const uid = normalizeUid(event?.uid)
    if (!uid) {
      throw Object.assign(new Error('缺少用户 UID'), { code: 'missing_uid' })
    }

    const { OPENID } = cloud.getWXContext()
    const collection = db.collection('checkins')
    const docRef = collection.doc(uid)

    const existingById = await ensureExistingDocument(collection, uid, OPENID)
    if (existingById) {
      return {
        ok: true,
        exists: true,
        data: existingById
      }
    }

    const existingByField = await findDocumentByUid(collection, uid, OPENID)
    if (existingByField) {
      return {
        ok: true,
        exists: true,
        data: existingByField
      }
    }

    const now = db.serverDate()
    try {
      await docRef.set({
        data: {
          uid,
          ownerOpenid: OPENID,
          info: [],
          createdAt: now,
          updatedAt: now
        }
      })
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
      const errMsg = typeof error?.errMsg === 'string' ? error.errMsg.toLowerCase() : message
      const isDuplicate =
        message.includes('duplicate key') ||
        message.includes('already exists') ||
        errMsg.includes('duplicate key') ||
        errMsg.includes('already exists') ||
        error?.code === 'DATABASE_REALTIME_LISTENER_DUP_FAIL'
      if (!isDuplicate) {
        throw error
      }

      const fallbackById = await ensureExistingDocument(collection, uid, OPENID)
      if (fallbackById) {
        return {
          ok: true,
          exists: true,
          data: fallbackById
        }
      }

      const fallbackByField = await findDocumentByUid(collection, uid, OPENID)
      if (fallbackByField) {
        return {
          ok: true,
          exists: true,
          data: fallbackByField
        }
      }

      throw error
    }

    const created = mapDocumentSnapshot(
      {
        _id: uid,
        uid,
        ownerOpenid: OPENID,
        info: [],
        createdAt: now,
        updatedAt: now
      },
      OPENID
    )

    return {
      ok: true,
      created: true,
      data: created
    }
  } catch (error) {
    console.error('[ensureCheckinsDoc] failed', error)
    return {
      ok: false,
      code: error.code || error.errCode || 'internal_error',
      message: error.message || error.errMsg || '初始化打卡记录失败'
    }
  }
}
