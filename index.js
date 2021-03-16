const { createConnection } = require('ilp-protocol-stream')
const SPSP = require('ilp-protocol-spsp')
const Plugin = require('ilp-plugin-btp')

const ILP_CONNECTOR_ADDR = 'Ilp-balancer-f7a914269dcebac1.elb.us-west-2.amazonaws.com'
const wallet = '$spsp.staging.coil.com/donate/flossbanktest' // '$ilp-sandbox.uphold.com/PAeaa2ZLE7f9'

exports.handler = async (event) => {
  console.log('here event received', { event })
  const {
    destination_account: destinationAccount,
    shared_secret: sharedSecret
  } = await SPSP.query(wallet)

  console.error({ destinationAccount, sharedSecret })

  console.log('creating connection')
  const connection = await createConnection({
    plugin: new Plugin({ server: `btp+ws://:asdf@${ILP_CONNECTOR_ADDR}:7768` }),
    destinationAccount,
    sharedSecret: Buffer.from(sharedSecret, 'base64'),
    slippage: 1.0
  })

  console.log('connection created')
  const stream = connection.createStream()

  stream.on('outgoing_money', () => {
    console.log('received outgoingmoney event')
  })
  stream.on('close', () => {
    console.log('stream closed')
  })

  console.log('stream created')
  stream.setSendMax(15000000)
  console.log('set max ')

  setTimeout(() => {}, 30000)
}
