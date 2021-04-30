exports.process = async ({ record, log, db, dynamo }) => {

  const { maintainerId } = JSON.parse(record.body)

  log.info('Starting process of maintainer payout %s', maintainerId)

  // If another lambda has already picked up this transaction, it'll be locked on maintainer id
  // preventing us from double paying maintainers.
  // This will throw if it's locked
  const lockInfo = await dynamo.lockOrg({ maintainerId })
  log.info({ lockInfo })

  const { payouts, ilpPaymentPointer } = await db.getPendingMaintainerPayouts({ maintainerId })
  const payoutIds = payouts.map(({ id }) => id)

  // Payout amount will be in denomination of millicents (1/1000 of a cent)
  const payoutAmount = payouts.reduce((sum, p) => sum + p.amount, 0)

  await ilp.sendIlpPayment({ pointer: ilpPaymentPointer, amount: payoutAmount })

  await db.updatePayoutsToPaid({ payoutIds, maintainerId, ilpPaymentPointer })

  await dynamo.unlockOrg({ maintainerId })

  log.info('Finished paying maintainer')
  return { success: true }
}
