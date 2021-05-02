exports.process = async ({ record, log, db, dynamo, ilp }) => {
  const { maintainerId } = JSON.parse(record.body)

  log.info('Starting process of maintainer payout %s', maintainerId)

  // If another lambda has already picked up this transaction, it'll be locked on maintainer id
  // preventing us from double paying maintainers.
  // This will throw if it's locked
  const lockInfo = await dynamo.lockMaintainer({ maintainerId })
  log.info({ lockInfo })

  const maintainer = await db.getPendingMaintainerPayouts({ maintainerId })
  // If no maintainer exists with pending payouts and a payment pointer
  if (!maintainer || !maintainer.payouts) {
    await dynamo.unlockMaintainer({ maintainerId })
    log.info('Maintainer %s did not have any pending payouts or didn\'t have a payout pointer', maintainerId)
    return { success: true }
  }

  const { payouts, ilpPaymentPointer } = maintainer

  const payoutIds = payouts.map(({ id }) => id)

  // Payout amount will be in denomination of millicents (1/1000 of a cent)
  const payoutAmount = payouts.reduce((sum, p) => sum + p.amount, 0)

  await ilp.sendIlpPayment({ pointer: ilpPaymentPointer, amount: payoutAmount })

  await db.updatePayoutsToPaid({ payoutIds, maintainerId, ilpPaymentPointer })

  await dynamo.unlockMaintainer({ maintainerId })

  log.info('Finished paying maintainer')
  return { success: true }
}
