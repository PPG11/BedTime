const { initCloud, getDb } = require('../common/cloud')
const { success, failure } = require('../common/response')
const { COLLECTION: GN_COLLECTION } = require('../common/goodnight')

initCloud()

const EVENTS_COLLECTION = 'gn_reaction_events'

exports.main = async () => {
  try {
    const db = getDb()
    const eventsCollection = db.collection(EVENTS_COLLECTION)
    const _ = db.command

    const snapshot = await eventsCollection
      .where({ status: 'queued' })
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get()

    const events = snapshot.data || []
    if (events.length === 0) {
      return success({ consumed: 0, grouped: 0 })
    }

    const grouped = new Map()
    for (const event of events) {
      if (!event.messageId) {
        continue
      }
      const existing = grouped.get(event.messageId) || {
        deltaLikes: 0,
        deltaDislikes: 0,
        deltaScore: 0,
        eventIds: []
      }
      existing.deltaLikes += Number(event.deltaLikes) || 0
      existing.deltaDislikes += Number(event.deltaDislikes) || 0
      existing.deltaScore += Number(event.deltaScore) || 0
      existing.eventIds.push(event._id)
      grouped.set(event.messageId, existing)
    }

    const results = { consumed: events.length, grouped: grouped.size }
    const messagesCollection = db.collection(GN_COLLECTION)

    for (const [messageId, info] of grouped.entries()) {
      if (!messageId) {
        continue
      }
      const incData = {}
      if (info.deltaLikes !== 0) {
        incData.likes = _.inc(info.deltaLikes)
      }
      if (info.deltaDislikes !== 0) {
        incData.dislikes = _.inc(info.deltaDislikes)
      }
      if (info.deltaScore !== 0) {
        incData.score = _.inc(info.deltaScore)
      }
      if (Object.keys(incData).length === 0) {
        for (const eventId of info.eventIds) {
          await eventsCollection.doc(eventId).update({ data: { status: 'done' } })
        }
        continue
      }

      try {
        await messagesCollection.doc(messageId).update({ data: incData })
        for (const eventId of info.eventIds) {
          await eventsCollection.doc(eventId).update({ data: { status: 'done' } })
        }
      } catch (error) {
        console.error('gnReactionsConsume update failed', messageId, error)
        for (const eventId of info.eventIds) {
          await eventsCollection.doc(eventId).update({ data: { status: 'failed' } })
        }
      }
    }

    return success(results)
  } catch (error) {
    console.error('gnReactionsConsume error', error)
    return failure(error)
  }
}
