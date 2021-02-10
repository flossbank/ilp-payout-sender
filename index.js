const { createConnection } = require('ilp-protocol-stream')
const SPSP = require('ilp-protocol-spsp')
const Plugin = require('ilp-plugin-btp')

exports.handler = async (event) => {
  console.log('here event received', { event })
  const {
    destination_account: destinationAccount,
    shared_secret: sharedSecret
  } = await SPSP.query('$ilp.uphold.com/yn8MbK2wan7P')

  console.error({ destinationAccount, sharedSecret })

  const connection = await createConnection({
    plugin: new Plugin({ server: 'btp+ws://:asdf@172.31.10.54:7768' }),
    destinationAccount,
    sharedSecret: Buffer.from(sharedSecret, 'base64')
  })

  console.log('connection created')
  const stream = connection.createStream()
  console.log('stream created')
  stream.setSendMax(150)
  console.log('set max ')
}
