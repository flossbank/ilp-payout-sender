const test = require('ava')
const sinon = require('sinon')
const Ilp = require('../lib/ilp')
const EventEmitter = require('events')
const IlpProtocolStream = require('ilp-protocol-stream')
const SPSP = require('ilp-protocol-spsp')

// these tests are serial because we aren't dep injecting the ILP deps,
// so they have to be reset after each test

test.beforeEach((t) => {
  const log = { info: sinon.stub() }
  const config = { getIlpConnectorAddress: sinon.stub().resolves('ilpaddy') }

  t.context.connection = { end: sinon.stub() }

  sinon.stub(IlpProtocolStream, 'createConnection').resolves(t.context.connection)
  sinon.stub(SPSP, 'query').resolves({
    destination_account: 'abc',
    shared_secret: 'xyz'
  })

  t.context.ilp = new Ilp({ log, config })
})

test.afterEach((t) => {
  IlpProtocolStream.createConnection.restore()
  SPSP.query.restore()
})

test.serial('sendMoney | happy path', async (t) => {
  const { ilp } = t.context
  const fakeStream = new EventEmitter()

  const params = {
    ilpAmount: 1234,
    connection: {
      createStream: sinon.stub().returns(fakeStream)
    }
  }

  fakeStream.destroy = sinon.stub()
  fakeStream.setSendMax = sinon.stub()

  // not awaiting the promise here, since I plan to emit events from the stream
  // and make assertions thereupon
  const result = ilp.sendMoney(params)

  t.true(params.connection.createStream.calledOnce)
  t.true(fakeStream.setSendMax.calledWith(1234))

  // this event says we sent 1000/1234 of the money
  // so the connection should remain open
  fakeStream.emit('outgoing_money', '1000')
  t.true(fakeStream.destroy.notCalled)

  // we now finish sending and expect the stream to be destroyed
  fakeStream.emit('outgoing_money', '234')
  t.true(fakeStream.destroy.calledOnce)

  // since destroy was called, we close the stream and the promise should resolve
  fakeStream.emit('close')

  const { success, remainingAmount } = await result
  t.deepEqual(success, true)
  t.deepEqual(remainingAmount, 0)
})

test.serial('sendMoney | stream closes before all money is sent -> reject', async (t) => {
  const { ilp } = t.context
  const fakeStream = new EventEmitter()
  fakeStream.setSendMax = sinon.stub()

  const params = {
    ilpAmount: 1234,
    connection: {
      createStream: sinon.stub().returns(fakeStream)
    }
  }

  const result = ilp.sendMoney(params)

  fakeStream.emit('outgoing_money', '1000')

  // calling this before all 1234 was sent, simulating an expected close
  fakeStream.emit('close')

  const { success, remainingAmount } = await result
  t.deepEqual(success, false)
  t.deepEqual(remainingAmount, 234)
})

test.serial('sendMoney | error -> reject', async (t) => {
  const { ilp } = t.context
  const fakeStream = new EventEmitter()
  fakeStream.setSendMax = sinon.stub()

  const params = {
    ilpAmount: 1234,
    connection: {
      createStream: sinon.stub().returns(fakeStream)
    }
  }

  const result = ilp.sendMoney(params)

  fakeStream.emit('error', new Error('halp!'))

  await t.throwsAsync(result, { message: 'halp!' })
})

test.serial('sendIlpPayment', async (t) => {
  const { ilp } = t.context
  ilp.sendMoney = sinon.stub().resolves({ success: true, remainingAmount: 0 })

  const { success, remainingAmount } = await ilp.sendIlpPayment({
    amount: 1234,
    pointer: '$helloworld'
  })

  // it should query the pointer
  t.deepEqual(SPSP.query.lastCall.args, ['$helloworld'])

  // it should create the connection
  t.true(IlpProtocolStream.createConnection.calledOnce)
  const [connArgs] = IlpProtocolStream.createConnection.lastCall.args

  t.is(connArgs.destinationAccount, 'abc')
  t.deepEqual(connArgs.sharedSecret, Buffer.from('xyz', 'base64'))
  t.is(connArgs.slippage, 1.0)

  // it should send the money (and the correct amount)
  t.true(ilp.sendMoney.calledOnce)
  const [sendArgs] = ilp.sendMoney.lastCall.args

  t.is(sendArgs.ilpAmount, 12340000)

  // it should end the connection
  t.true(t.context.connection.end.calledOnce)

  t.deepEqual(success, true)
  t.deepEqual(remainingAmount, 0)
})

test.serial('sendIlpPayment | has remaining balance', async (t) => {
  const { ilp } = t.context
  ilp.sendMoney = sinon.stub().resolves({ success: false, remainingAmount: 10000 })

  const { success, remainingAmount } = await ilp.sendIlpPayment({
    amount: 1234,
    pointer: '$helloworld'
  })

  // it should query the pointer
  t.deepEqual(SPSP.query.lastCall.args, ['$helloworld'])

  // it should create the connection
  t.true(IlpProtocolStream.createConnection.calledOnce)
  const [connArgs] = IlpProtocolStream.createConnection.lastCall.args

  t.is(connArgs.destinationAccount, 'abc')
  t.deepEqual(connArgs.sharedSecret, Buffer.from('xyz', 'base64'))
  t.is(connArgs.slippage, 1.0)

  // it should send the money (and the correct amount)
  t.true(ilp.sendMoney.calledOnce)
  const [sendArgs] = ilp.sendMoney.lastCall.args

  t.is(sendArgs.ilpAmount, 12340000)

  // it should end the connection
  t.true(t.context.connection.end.calledOnce)

  t.deepEqual(success, false)
  t.deepEqual(remainingAmount, 1)
})
