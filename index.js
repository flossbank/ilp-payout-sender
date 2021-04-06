const { createConnection } = require('ilp-protocol-stream')
const SPSP = require('ilp-protocol-spsp')
const Plugin = require('ilp-plugin-btp')

// the address of the internal NLB that the lambda will call to connect to the ILP connector
const { ILP_CONNECTOR_ADDR } = process.env

// creates stream, sets max, resolves when stream acknowledges outgoing money
function sendMoney (connection, amount) {
  return new Promise((resolve, reject) => {
    const state = {
      moneySent: false,
      totalSent: 0
    }

    console.log('Creating stream...')
    const stream = connection.createStream()
    console.log('Stream created successfully')

    stream.on('outgoing_money', (sentAmount) => {
      const sentAmountInt = parseInt(sentAmount, 10)

      console.log('Money sent successfully (%d)!', sentAmountInt)

      state.totalSent += sentAmountInt

      if (state.totalSent === amount) {
        state.moneySent = true

        console.log('All money is sent. Closing stream...')
        stream.destroy()
      } else {
        console.log('%d !== %d... still waiting for all money to send', state.totalSent, amount)
      }
    })

    stream.once('close', () => {
      console.log('Payment stream closed')
      if (state.moneySent) resolve()
      else reject(new Error('Stream closed without emitting outgoing_money event'))
    })

    stream.once('error', (err) => {
      reject(err)
    })

    console.log('Setting stream max to specified amount (%d)', amount)
    stream.setSendMax(amount)
  })
}

exports.handler = async (event) => {
  const { walletAddress, amount } = event

  console.log('Sending %d to %s', amount, walletAddress)

  const {
    destination_account: destinationAccount,
    shared_secret: sharedSecret
  } = await SPSP.query(walletAddress)

  console.log({ destinationAccount, sharedSecret })

  console.log('Creating connection to Flossbank ILP connector...')
  const plugin = new Plugin({ server: `btp+ws://:asdf@${ILP_CONNECTOR_ADDR}:7768` })

  const connection = await createConnection({
    plugin,
    destinationAccount,
    sharedSecret: Buffer.from(sharedSecret, 'base64'),
    slippage: 1.0
  })

  console.log('Connection created successfully')

  await sendMoney(connection, amount)

  console.log('Closing connection to ILP connector...')
  await connection.end()

  // connection will probably disconnect the plugin automatically
  if (plugin.isConnected()) {
    console.log('Disconnecting from BTP server')
    await plugin.disconnect()
  }
}
