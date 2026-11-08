// wx-server-sdk can wrap a transaction conflict as the numeric -501001
// resource error, so the database SDK's string-code retry does not catch it.
// Only a confirmed conflict is retried; timeouts and unknown commits are not.
const isConflict = error => [error?.code, error?.errCode, error?.message, error?.errMsg]
  .some(value => typeof value === 'string' && /DATABASE_TRANSACTION_CONFLICT|ResourceUnavailable\.TransactionConflict/.test(value))

async function transact(db, operation, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await db.runTransaction(operation) } catch (error) {
      if (attempt >= 3 || !isConflict(error)) throw error
      await sleep(40 * 2 ** attempt + Math.floor(random() * 40))
    }
  }
}

module.exports = { transact }
