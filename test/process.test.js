const test = require('ava')
const sinon = require('sinon')
const Process = require('../lib/process')

test.beforeEach((t) => {
  const log = { info: sinon.stub() }
  const db = {
    getPendingMaintainerPayouts: sinon.stub().resolves(),
    updatePayoutsToPaid: sinon.stub().resolves(),
    addDifferentialPayout: sinon.stub().resolves()
  }
  const dynamo = {
    lockMaintainer: sinon.stub().resolves(),
    unlockMaintainer: sinon.stub().resolves()
  }
  const ilp = {
    sendIlpPayment: sinon.stub().resolves({ success: true, remainingAmount: 0 })
  }

  t.context.deps = { log, db, dynamo, ilp }
})

test('process | no pending payouts', async (t) => {
  const record = {
    body: JSON.stringify({
      maintainerId: 'aaaaaaaaaaaa'
    })
  }
  const { deps } = t.context

  for (const dbReturnResult of [undefined, { payouts: null }, { payouts: [] }]) {
    deps.db.getPendingMaintainerPayouts.resolves(dbReturnResult)

    const input = { ...deps, record }

    const result = await Process.process(input)

    // it should lock and unlock the maintainer id, since there is no work to do
    t.deepEqual(deps.dynamo.lockMaintainer.lastCall.args, [{ maintainerId: 'aaaaaaaaaaaa' }])
    t.deepEqual(deps.dynamo.unlockMaintainer.lastCall.args, [{ maintainerId: 'aaaaaaaaaaaa' }])

    // it shouldn't have updated the db or tried to send money
    t.true(deps.db.updatePayoutsToPaid.notCalled)
    t.true(deps.ilp.sendIlpPayment.notCalled)

    t.deepEqual(result, { success: true })

    deps.db.getPendingMaintainerPayouts.reset()
    deps.dynamo.lockMaintainer.reset()
    deps.dynamo.unlockMaintainer.reset()
  }
})

test('process | pending payouts', async (t) => {
  const record = {
    body: JSON.stringify({
      maintainerId: 'aaaaaaaaaaaa'
    })
  }
  const { deps } = t.context

  deps.db.getPendingMaintainerPayouts.resolves({
    payouts: [
      {
        id: 'payout-id',
        amount: 12345
      },
      {
        id: 'payout-id2',
        amount: 54321
      }
    ],
    ilpPaymentPointer: '$helloworld'
  })

  const input = { ...deps, record }

  const result = await Process.process(input)

  // it should lock the maintainer id
  t.deepEqual(deps.dynamo.lockMaintainer.lastCall.args, [{ maintainerId: 'aaaaaaaaaaaa' }])

  // it should try to send the money
  t.deepEqual(deps.ilp.sendIlpPayment.lastCall.args, [{
    pointer: '$helloworld',
    amount: 66666
  }])

  // it should update the db
  t.deepEqual(deps.db.updatePayoutsToPaid.lastCall.args, [{
    maintainerId: 'aaaaaaaaaaaa',
    ilpPaymentPointer: '$helloworld',
    payoutIds: ['payout-id', 'payout-id2']
  }])

  // it should unlock the maintainer id
  t.deepEqual(deps.dynamo.unlockMaintainer.lastCall.args, [{ maintainerId: 'aaaaaaaaaaaa' }])

  t.deepEqual(result, { success: true })
})

test('process | pending payouts only partial paid', async (t) => {
  // Ilp says it didn't complete 1000 worth of the payouts
  t.context.deps.ilp.sendIlpPayment.resolves({ success: false, remainingAmount: 1000 })

  const record = {
    body: JSON.stringify({
      maintainerId: 'aaaaaaaaaaaa'
    })
  }
  const { deps } = t.context

  deps.db.getPendingMaintainerPayouts.resolves({
    payouts: [
      {
        id: 'payout-id',
        amount: 12345
      },
      {
        id: 'payout-id2',
        amount: 54321
      }
    ],
    ilpPaymentPointer: '$helloworld'
  })

  const input = { ...deps, record }

  await t.throwsAsync(async () => await Process.process(input))
  // try {
  //   await Process.process(input)
  // } catch (e) {
  //   t.deepEqual(e.message, 'For some reason ILP sender failed')
  // }

  // it should lock the maintainer id
  t.deepEqual(deps.dynamo.lockMaintainer.lastCall.args, [{ maintainerId: 'aaaaaaaaaaaa' }])

  // it should try to send the money
  t.deepEqual(deps.ilp.sendIlpPayment.lastCall.args, [{
    pointer: '$helloworld',
    amount: 66666
  }])

  // it should update the db
  t.deepEqual(deps.db.updatePayoutsToPaid.lastCall.args, [{
    maintainerId: 'aaaaaaaaaaaa',
    ilpPaymentPointer: '$helloworld',
    payoutIds: ['payout-id', 'payout-id2']
  }])

  // it should push a new payout onto the maintainer
  t.deepEqual(deps.db.addDifferentialPayout.lastCall.args, [{
    maintainerId: 'aaaaaaaaaaaa',
    remainingAmount: 1000
  }])

  // it should unlock the maintainer id
  t.deepEqual(deps.dynamo.unlockMaintainer.lastCall.args, [{ maintainerId: 'aaaaaaaaaaaa' }])
})
