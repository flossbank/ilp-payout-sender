const { MongoClient, ObjectId } = require('mongodb')
const ULID = require('ulid')

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
    // Grab a single maintainer who has an ILP payment pointer
    // and filter their payouts array to only the unpaid ones
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
      _id: ObjectId(maintainerId)
    },
    {
      $set: {
        'payouts.$[elem].paid': true,
        'payouts.$[elem].payoutEndpoint': {
          type: 'ilp',
          endpoint: ilpPaymentPointer
        },
        'payouts.$[elem].paidTimestamp': Date.now()
      }
    }, {
      arrayFilters: [{ 'elem.id': { $in: payoutIds } }]
    })
  }

  async addDifferentialPayout ({ maintainerId, remainingAmount }) {
    return this.db.collection(MAINTAINERS_COLLECTION).updateOne({
      _id: ObjectId(maintainerId)
    },
    {
      $push: {
        payouts: {
          id: ULID.ulid(),
          timestamp: Date.now(),
          amount: remainingAmount,
          donationIds: [],
          adIds: []
        }
      }
    })
  }
}

module.exports = Mongo
