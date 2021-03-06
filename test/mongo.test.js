const test = require('ava')
const sinon = require('sinon')
const ulid = require('ulid')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Config = require('../lib/config')
const Mongo = require('../lib/mongo')

test.before(async (t) => {
  const config = new Config({
    kms: {}
  })

  const mongo = new MongoMemoryServer()
  const mongoUri = await mongo.getUri()

  ulid.ulid = sinon.stub().returns('zzzzzzzzzzzz')
  Date.now = sinon.stub().returns(1234)

  config.decrypt = sinon.stub().returns(mongoUri)
  t.context.Mongo = new Mongo({ config, log: { info: sinon.stub() } })
  await t.context.Mongo.connect()

  t.context.maintainer1Payouts = [
    {
      id: 'aaaaaaaaaaa6',
      amount: 100,
      donationIds: ['bbbbbbbbbbbb'],
      adIds: ['dddddddddddd'],
      timestamp: 123456,
      paid: true
    },
    {
      id: 'aaaaaaaaaaaa',
      amount: 100,
      donationIds: ['bbbbbbbbbbbb'],
      adIds: ['dddddddddddd'],
      timestamp: 123456
    },
    {
      id: 'aaaaaaaaaaa1',
      amount: 150,
      donationIds: ['bbbbbbbbbbbb'],
      adIds: ['dddddddddddd'],
      timestamp: 123456
    }
  ]
  const { insertedId: userId1 } = await t.context.Mongo.db.collection('users').insertOne({
    name: 'austria',
    payoutInfo: {
      ilpPointer: 'test-ilp-pointer'
    },
    payouts: t.context.maintainer1Payouts
  })
  t.context.userIdWithPayoutsAndIlp = userId1

  const { insertedId: userId2 } = await t.context.Mongo.db.collection('users').insertOne({
    name: 'australia',
    payouts: [{
      id: 'aaaaaaaaaaaa',
      amount: 100,
      donationIds: ['bbbbbbbbbbbb'],
      adIds: ['dddddddddddd'],
      timestamp: 123456
    }]
  })
  t.context.userIdWithNoIlp = userId2

  const { insertedId: userId6 } = await t.context.Mongo.db.collection('users').insertOne({
    name: 'russia',
    payoutInfo: {
      ilpPointer: 'test-ilp-pointer'
    },
    payouts: [{
      id: 'aaaaaaaaaaa2',
      amount: 150,
      donationIds: ['bbbbbbbbbbbb'],
      adIds: ['dddddddddddd'],
      timestamp: 123456,
      paid: true
    }]
  })
  t.context.userIdWithPaidPayouts = userId6
})

test.after(async (t) => {
  await t.context.Mongo.close()
})

test('getPendingMaintainerPayouts', async (t) => {
  let maintainer
  maintainer = await t.context.Mongo.getPendingMaintainerPayouts({ maintainerId: t.context.userIdWithPayoutsAndIlp })
  // This maintainer should be returned, and should have just 2 of the 3 unpaid payouts
  t.deepEqual(maintainer.payouts, t.context.maintainer1Payouts.slice(1))

  maintainer = await t.context.Mongo.getPendingMaintainerPayouts({ maintainerId: t.context.userIdWithNoIlp })
  // This maintainer should return null because they have no ILP Pointer
  t.true(maintainer === undefined)

  maintainer = await t.context.Mongo.getPendingMaintainerPayouts({ maintainerId: t.context.userIdWithPaidPayouts })
  // This maintainer should return but have no payouts because they're all paid
  t.true(maintainer.payouts.length === 0)
})

test('updatePayoutsToPaid', async (t) => {
  const { insertedId: userId } = await t.context.Mongo.db.collection('users').insertOne({
    name: 'halp',
    payoutInfo: {
      ilpPointer: 'test-ilp-pointer'
    },
    payouts: [
      {
        id: 'aaaaaaaaaaa2',
        amount: 150,
        donationIds: ['bbbbbbbbbbbb'],
        adIds: ['dddddddddddd'],
        timestamp: 123456,
        paid: true,
        paidTimestamp: 123456,
        payoutEndpoint: {
          type: 'ilp',
          endpoint: 'test-ilp-pointer'
        }
      },
      {
        id: 'aaaaaaaaaaa3',
        amount: 150,
        donationIds: ['bbbbbbbbbbbb'],
        adIds: ['dddddddddddd'],
        timestamp: 123456
      },
      {
        id: 'aaaaaaaaaaa4',
        amount: 150,
        donationIds: ['bbbbbbbbbbbb'],
        adIds: ['dddddddddddd'],
        timestamp: 123456
      }
    ]
  })

  // Just the two unpaid payouts were paid
  const payoutsMade = ['aaaaaaaaaaa3', 'aaaaaaaaaaa4']
  await t.context.Mongo.updatePayoutsToPaid({ maintainerId: userId.toString(), payoutIds: payoutsMade, ilpPaymentPointer: 'test-ilp-pointer' })

  const maintainerAfterUpdate = await t.context.Mongo.db.collection('users').findOne({
    _id: userId
  })

  t.true(maintainerAfterUpdate.payouts.every((p) => {
    return (p.paid === true &&
      !!p.paidTimestamp &&
      p.payoutEndpoint.type === 'ilp' &&
      p.payoutEndpoint.endpoint === 'test-ilp-pointer')
  }))
})

test('addDifferentialPayout', async (t) => {
  const { insertedId: userId } = await t.context.Mongo.db.collection('users').insertOne({
    name: 'roger',
    payoutInfo: {
      ilpPointer: 'test-ilp-pointer'
    },
    payouts: [
      {
        id: 'aaaaaaaaaaa3',
        amount: 150,
        donationIds: ['bbbbbbbbbbbb'],
        adIds: ['dddddddddddd'],
        timestamp: 123456
      }
    ]
  })

  await t.context.Mongo.addDifferentialPayout({ maintainerId: userId.toString(), remainingAmount: 1000 })

  const maintainerAfterUpdate = await t.context.Mongo.db.collection('users').findOne({
    _id: userId
  })

  t.deepEqual(maintainerAfterUpdate.payouts.length, 2)

  const payoutInserted = maintainerAfterUpdate.payouts.find((p) => p.id === 'zzzzzzzzzzzz')
  t.deepEqual(payoutInserted, {
    id: 'zzzzzzzzzzzz',
    timestamp: 1234,
    amount: 1000,
    donationIds: [],
    adIds: []
  })
})

test('close closes it', async (t) => {
  const mongo = new Mongo({})
  await mongo.close() // nothing to close here

  mongo.mongoClient = { close: sinon.stub() }
  await mongo.close()

  t.true(mongo.mongoClient.close.calledOnce)
})
