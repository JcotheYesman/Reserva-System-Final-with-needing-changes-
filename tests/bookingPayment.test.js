import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCheckoutAmounts } from '../src/utils/bookingPayment.js'
import { calculateBookingFees } from '../src/utils/fees.js'

test('full payment includes the full rental and service fee once', () => {
  const fees = { courtRate: 400, serviceFee: 20, userTotal: 420 }
  assert.deepEqual(calculateCheckoutAmounts(fees, 'full'), {
    option: 'full', courtRate: 400, serviceFee: 20, total: 420,
    amountToPayNow: 420, remainingBalance: 0,
  })
})

test('half payment takes half the rental plus the complete service fee', () => {
  const fees = { courtRate: 400, serviceFee: 20, userTotal: 420 }
  assert.deepEqual(calculateCheckoutAmounts(fees, 'half'), {
    option: 'half', courtRate: 400, serviceFee: 20, total: 420,
    amountToPayNow: 220, remainingBalance: 200,
  })
})

test('the configured minimum service fee is collected in the first payment only', () => {
  const fees = calculateBookingFees(100)
  assert.equal(fees.serviceFee, 20)
  const checkout = calculateCheckoutAmounts(fees, 'half')
  assert.equal(checkout.amountToPayNow, 70)
  assert.equal(checkout.remainingBalance, 50)
})

test('half payment rounds fractional cents consistently', () => {
  const fees = { courtRate: 101.01, serviceFee: 20, userTotal: 121.01 }
  const checkout = calculateCheckoutAmounts(fees, 'half')
  assert.equal(checkout.amountToPayNow, 70.51)
  assert.equal(checkout.remainingBalance, 50.5)
})

test('invalid totals and payment choices are rejected', () => {
  assert.throws(() => calculateCheckoutAmounts({ courtRate: 100, serviceFee: 20, userTotal: 130 }, 'full'), /price is invalid/)
  assert.throws(() => calculateCheckoutAmounts({ courtRate: 100, serviceFee: 20, userTotal: 120 }, 'quarter'), /Choose full payment/)
})
