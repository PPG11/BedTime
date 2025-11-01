const { initCloud, getDb, getOpenId } = require('common/cloud')
const { ensureUser } = require('common/users')
const { createError, normalizeError } = require('common/errors')

initCloud()

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function toResponsePayload(documentId, openid, user, record) {
  const infoList = isPlainObject(record) && Array.isArray(record.info) ? record.info : []
  const uid = record && typeof record.uid === 'string' && record.uid ? record.uid : user.uid
  const owner = record && typeof record.ownerOpenid === 'string' && record.ownerOpenid ? record.ownerOpenid : openid
  const createdAt = record && record.createdAt ? record.createdAt : null
  const updatedAt = record && record.updatedAt ? record.updatedAt : null
  return {
    documentId,
    uid,
    ownerOpenid: owner,
    info: infoList,
    createdAt,
    updatedAt
  }
}

exports.main = async (event, context) => {
  const db = getDb()

  try {
    const openid = getOpenId(context)
    if (!openid) {
      throw createError('UNAUTHORIZED', '缺少 OPENID')
    }

    const user = await ensureUser(openid)
    const requestedUid = event && typeof event.uid === 'string' ? event.uid.trim() : ''
    if (requestedUid && requestedUid !== user.uid) {
      throw createError('FORBIDDEN', '无法访问其他用户的打卡记录')
    }

    const docId = user.uid
    const collection = db.collection('checkins')
    const docRef = collection.doc(docId)

    let existing = null
    try {
      const snapshot = await docRef.get()
      if (snapshot && snapshot.data) {
        existing = snapshot.data
      }
    } catch (error) {
      const message = error && typeof error.errMsg === 'string' ? error.errMsg : ''
      if (!/not exist|not found|fail/i.test(message)) {
        throw error
      }
    }

    if (!existing) {
      let legacyRecord = null
      try {
        const legacySnapshot = await collection.where({ uid: user.uid }).limit(1).get()
        const legacyCandidate = Array.isArray(legacySnapshot?.data) ? legacySnapshot.data[0] : null
        if (legacyCandidate && Array.isArray(legacyCandidate.info)) {
          legacyRecord = legacyCandidate
        }
      } catch (error) {
        const message = error && typeof error.errMsg === 'string' ? error.errMsg : ''
        if (!/not exist|not found|fail/i.test(message)) {
          throw error
        }
      }

      if (legacyRecord) {
        const infoList = Array.isArray(legacyRecord.info) ? legacyRecord.info : []
        const owner =
          legacyRecord && typeof legacyRecord.ownerOpenid === 'string' && legacyRecord.ownerOpenid
            ? legacyRecord.ownerOpenid
            : openid
        const createdAtValue = legacyRecord.createdAt || db.serverDate()
        const updatedAtValue = db.serverDate()

        await docRef.set({
          data: {
            uid: user.uid,
            ownerOpenid: owner,
            info: infoList,
            createdAt: createdAtValue,
            updatedAt: updatedAtValue
          }
        })

        const legacyId = legacyRecord && typeof legacyRecord._id === 'string' ? legacyRecord._id : ''
        if (legacyId && legacyId !== docId) {
          try {
            await collection.doc(legacyId).remove()
          } catch (cleanupError) {
            console.warn('ensureCheckinsDoc failed to remove legacy record', cleanupError)
          }
        }

        existing = {
          uid: user.uid,
          ownerOpenid: owner,
          info: infoList,
          createdAt: legacyRecord.createdAt || new Date(),
          updatedAt: new Date()
        }
      }
    }

    if (!existing) {
      const now = db.serverDate()
      await docRef.set({
        data: {
          uid: user.uid,
          ownerOpenid: openid,
          info: [],
          createdAt: now,
          updatedAt: now
        }
      })

      existing = {
        uid: user.uid,
        ownerOpenid: openid,
        info: [],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }

    const updates = {}
    if (typeof existing.uid !== 'string' || !existing.uid) {
      updates.uid = user.uid
    }
    if (typeof existing.ownerOpenid !== 'string' || !existing.ownerOpenid) {
      updates.ownerOpenid = openid
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = db.serverDate()
      await docRef.update({ data: updates })
      existing = Object.assign({}, existing, updates, {
        updatedAt: new Date()
      })
    }

    return {
      ok: true,
      data: toResponsePayload(docId, openid, user, existing)
    }
  } catch (error) {
    console.error('ensureCheckinsDoc error', error)
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
