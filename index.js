const AWS = require('aws-sdk')
const Pino = require('pino')
const Process = require('./lib/process')
const Config = require('./lib/config')
const Db = require('./lib/mongo')
const Dynamo = require('./lib/dynamo')
const Ilp = require('./lib/ilp')

const kms = new AWS.KMS({ region: 'us-west-2' })
const docs = new AWS.DynamoDB.DocumentClient({ region: 'us-west-2' })

/*
- Get maintainer id from SQS event
- Lock on maintainer id for processing so no other lambda duplicates payout
- Look up payouts for the maintainer that have not been paid, as well as their ILP pointer
- Initiate ILP sending of payment
- Mark payouts as paid, as well as the timestamp and payment pointer they were sent to
- Unlock maintainer ID and clean up
*/
exports.handler = async (event) => {
  const log = Pino()
  const dynamo = new Dynamo({ log, docs })
  const config = new Config({ log, kms })
  const ilp = new Ilp({ log })
  const db = new Db({ log, config })
  await db.connect()

  try {
    await Promise.all(event.Records.map(record => Process.process({ record, db, dynamo, ilp, log })))
  } finally {
    await db.close()
  }
}
