const { initCloud, getDb } = require('common/cloud')
const { formatDateFromMs } = require('common/time')
const { success, failure } = require('common/response')

initCloud()

const SLOT_COLLECTION = 'slot_daily'
const CHECKINS_COLLECTION = 'checkins'

function normalizeDateInput(value) {
  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    return value
  }
  return null
}

const MAX_IN_SIZE = 10

function chunkArray(values, size) {
  const chunks = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

async function fetchUserProfiles(db, uids) {
  const uniqueUids = Array.from(new Set(uids.filter(Boolean)))
  if (uniqueUids.length === 0) {
    return new Map()
  }
  const _ = db.command
  const queries = chunkArray(uniqueUids, MAX_IN_SIZE).map((chunk) =>
    db
      .collection('users')
      .where({ uid: _.in(chunk) })
      .field({ uid: true, slotKey: true })
      .get()
  )

  const snapshots = await Promise.all(queries)
  const map = new Map()
  for (const snapshot of snapshots) {
    for (const doc of snapshot.data || []) {
      map.set(doc.uid, doc)
    }
  }
  return map
}

exports.main = async (event) => {
  try {
    const db = getDb()
    const targetDate = normalizeDateInput(event?.date) || formatDateFromMs(Date.now() - 24 * 60 * 60 * 1000)

    const participantsBySlot = new Map()
    const collection = db.collection(CHECKINS_COLLECTION)
    const BATCH = 100
    let fetched = 0

    while (true) {
      const snapshot = await collection
        .where({ date: targetDate })
        .skip(fetched)
        .limit(BATCH)
        .get()

      const records = snapshot.data || []
      if (records.length === 0) {
        break
      }

      const uids = records.map((item) => item.uid)
      const profiles = await fetchUserProfiles(db, uids)

      for (const record of records) {
        const profile = profiles.get(record.uid) || {}
        const slotKey = typeof profile.slotKey === 'string' ? profile.slotKey : '00:00'
        const entry = participantsBySlot.get(slotKey) || { participants: 0, hits: 0 }
        entry.participants += 1
        if (record.status === 'hit') {
          entry.hits += 1
        }
        participantsBySlot.set(slotKey, entry)
      }

      if (records.length < BATCH) {
        break
      }
      fetched += records.length
    }

    const rollupCollection = db.collection(SLOT_COLLECTION)
    let updated = 0
    for (const [slotKey, stats] of participantsBySlot.entries()) {
      const hitRate = stats.participants > 0 ? Number((stats.hits / stats.participants).toFixed(4)) : 0
      const docId = `${slotKey}#${targetDate}`
      await rollupCollection.doc(docId).set({
        data: {
          _id: docId,
          slotKey,
          date: targetDate,
          participants: stats.participants,
          hits: stats.hits,
          hitRate,
          updatedAt: db.serverDate()
        }
      })
      updated += 1
    }

    return success({ date: targetDate, slots: updated })
  } catch (error) {
    console.error('slotRollup error', error)
    return failure(error)
  }
}
