const { MongoClient, ObjectId } = require('mongodb')

const MONGO_DB = 'flossbank_db'
const MAINTAINERS_COLLECTION = 'users'

class Mongo {
  constructor ({ config, log }) {
    this.log = log
    this.config = config
    this.db = null
    this.mongoClient = null
  }

  async connect () {
    const mongoUri = await this.config.getMongoUri()
    this.mongoClient = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    })
    await this.mongoClient.connect()

    this.db = this.mongoClient.db(MONGO_DB)
  }

  async close () {
    if (this.mongoClient) return this.mongoClient.close()
  }

  async getPendingMaintainerPayouts ({ maintainerId }) {
    // Grab all maintainers who have a payout method (ILP pointer or otherwise)
    // and also have payouts that have not been paid
    const aggregationPipeline = [
      {
        $match: {
          _id: new ObjectId(maintainerId),
          'payoutInfo.ilpPointer': {
            $ne: null
          }
        }
      }, {
        $project: {
          payouts: {
            $filter: {
              input: '$payouts',
              as: 'payouts',
              cond: {
                $ne: [
                  '$$payouts.paid', true
                ]
              }
            }
          },
          ilpPaymentPointer: '$payoutInfo.ilpPointer'
        }
      }
    ]

    const result = await this.db.collection(MAINTAINERS_COLLECTION).aggregate(aggregationPipeline).toArray()
    // Result should only be 1 maintainer, so return array at index 0
    return result[0]
  }

  async updatePayoutsToPaid ({ payoutIds, maintainerId, ilpPaymentPointer }) {
    return this.db.collection(MAINTAINERS_COLLECTION).updateOne({
      _id: ObjectId(maintainerId),
      'payouts.id': { $in: payoutIds }
    }).update({
      $set: {
        'payouts.$.paid': true,
        'payouts.$.payoutEndpoint': {
          type: 'ilp',
          endpoint: ilpPaymentPointer
        },
        'payouts.$.paidTimestamp': Date.now()
      }
    })
  }
}

module.exports = Mongo
