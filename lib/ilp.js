const IlpProtocolStream = require('ilp-protocol-stream')
const SPSP = require('ilp-protocol-spsp')
const Plugin = require('ilp-plugin-btp')

class Ilp {
  constructor ({ log, config }) {
    this.log = log
    this.config = config
  }

  async sendMoney ({ ilpAmount, connection }) {
    return new Promise((resolve, reject) => {
      const state = {
        moneySent: false,
        totalSent: 0
      }

      // Wrap this whole thing in a try catch in case it errors and we've partially
      // sent payments
      try {
        this.log.info('Creating stream...')
        const stream = connection.createStream()
        this.log.info('Stream created successfully')

        stream.on('outgoing_money', (sentAmount) => {
          try {
            const sentAmountInt = parseInt(sentAmount, 10)

            this.log.info('Money sent successfully (%d)!', sentAmountInt)

            state.totalSent += sentAmountInt

            if (state.totalSent === ilpAmount) {
              state.moneySent = true

              this.log.info('All money is sent. Closing stream...')
              stream.destroy()
            } else {
              this.log.info('%d !== %d... still waiting for all money to send', state.totalSent, ilpAmount)
            }
          } catch (e) {
            resolve({ success: false, remainingAmount: ilpAmount - state.totalSent, error: e })
          }
        })

        stream.once('close', () => {
          this.log.info('Payment stream closed')
          if (state.moneySent) resolve({ success: true, remainingAmount: 0 })
          else resolve({ success: false, remainingAmount: ilpAmount - state.totalSent })
        })

        stream.once('error', (err) => {
          resolve({ success: false, remainingAmount: ilpAmount - state.totalSent, error: err })
        })

        this.log.info('Setting stream max to specified amount (%d)', ilpAmount)
        stream.setSendMax(ilpAmount)
      } catch (e) {
        resolve({ success: false, remainingAmount: ilpAmount - state.totalSent, error: e })
      }
    })
  }

  async sendIlpPayment ({ amount, pointer }) {
    this.log.info('Sending millicents %d to %s', amount, pointer)

    // ILP operates in one billionth of a dollar (nano dollar), so 1,000,000,000 would be 1 dollar payment
    // meaning to get to a 1 cent payment, we divide by 100 -> 10,000,000.
    // Thus, to get from our input of millicents (1/1000 of a cent) to ILP denomination of nanodollars,
    // we multiply our amount by 10,000.

    // So, for example if we were sending 1 cent, and our input is 1,000 millicents,
    // we'd send ILP 1,000 * 10,000 = 10,000,000,
    // which in ILP land is 1 cent.

    // to further verify in terms of nano dollars, if we receive an input of 1,000 millicents
    // to get to dollars we'd divide by 1000 (to get to cents), and then by 100 (to get to dollars)
    // meaning our input is actually 1,000 / 1,000 / 100 -> .01 dollars
    // To convert .01 dollars to nano dollars, we multiply by 1,000,000,000 => 10,000,000. This confirms
    // that to get from our input (1,000) to our desired ILP amount (10,000,000), we should multiply the
    // amount by 10,000
    const ilpScaledAmount = Math.floor(amount * 10000)

    this.log.info('Sending %d nano dollars', ilpScaledAmount)

    // the address of the internal NLB that the lambda will call to connect to the ILP connector
    const ilpConnectorAddr = await this.config.getIlpConnectorAddress()

    const {
      destination_account: destinationAccount,
      shared_secret: sharedSecret
    } = await SPSP.query(pointer)

    this.log.info({ destinationAccount, sharedSecret })

    const plugin = new Plugin({ server: `btp+ws://:asdf@${ilpConnectorAddr}:7768` })

    this.log.info('Creating connection to Flossbank ILP connector...')

    const connection = await IlpProtocolStream.createConnection({
      plugin,
      destinationAccount,
      sharedSecret: Buffer.from(sharedSecret, 'base64'),
      slippage: 1.0
    })

    this.log.info('Connection created successfully')

    let { success, remainingAmount, error } = await this.sendMoney({ ilpAmount: ilpScaledAmount, connection })

    // If we have sent NO money and the ilp sender failed, throw an error so we're notified of the failure
    if (error && remainingAmount === ilpScaledAmount) {
      this.log.info('ERROR: Encountered error when sending money via ILP and sent no money')
      throw error
    }

    // Simply log error, still continue noting the remaining amount but just log error for debugging purposes
    if (error) {
      this.log.info('ERROR: Encountered error when sending money via ILP: ', error.message)
    }

    // Reset remaining amount to millicents, where as ILP operates in nanodollars
    if (remainingAmount > 0) remainingAmount = remainingAmount / 10000

    this.log.info('Closing connection to ILP connector...')
    await connection.end()

    // Pass along success and remaining amount to caller so they can handle it
    return { success, remainingAmount: remainingAmount || 0, error }
  }
}

module.exports = Ilp
