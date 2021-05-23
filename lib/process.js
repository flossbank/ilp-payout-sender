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
  if (!maintainer || !maintainer.payouts || !maintainer.payouts.length) {
    await dynamo.unlockMaintainer({ maintainerId })
    log.info('Maintainer %s did not have any pending payouts or didn\'t have a payment pointer', maintainerId)
    return { success: true }
  }

  const { payouts, ilpPaymentPointer } = maintainer

  // Cache the payout ids that we're paying so we can update all of them to paid in the maintainer payouts ledger
  const payoutIds = payouts.map(({ id }) => id)

  // Payout amount is in millicents (1/1000 of a cent)
  const payoutAmount = payouts.reduce((sum, p) => sum + p.amount, 0)

  const { success, remainingAmount } = await ilp.sendIlpPayment({ pointer: ilpPaymentPointer, amount: payoutAmount })
  // If sending money for some reason didn't send the whole amount, mark this payout as paid and add a new
  // payout that is the remaining amount
  if (!success && remainingAmount > 0) {
    await db.addDifferentialPayout({ maintainerId, remainingAmount })
  }

  await db.updatePayoutsToPaid({ payoutIds, maintainerId, ilpPaymentPointer })

  await dynamo.unlockMaintainer({ maintainerId })

  // If the ILP sender did not succeed in all senses of the word, then throw an error so we're notified and
  // can dig in. It's fine to throw here, because even if this lambda fires again for the same maintainer,
  // no payments could ever be duplicately paid.
  if (!success) {
    throw new Error('For some reason ILP sender failed')
  }

  log.info('Finished paying maintainer')
  return { success: true }
}
