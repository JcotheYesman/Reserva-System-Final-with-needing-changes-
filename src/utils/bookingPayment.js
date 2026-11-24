const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export function calculateCheckoutAmounts(fees, option = 'full') {
  const courtRate = roundMoney(Number(fees?.courtRate))
  const serviceFee = roundMoney(Number(fees?.serviceFee))
  const total = roundMoney(Number(fees?.userTotal ?? courtRate + serviceFee))
  if (![courtRate, serviceFee, total].every(Number.isFinite) || courtRate < 0 || serviceFee < 0 || total <= 0 || total !== roundMoney(courtRate + serviceFee)) {
    throw new Error('The booking price is invalid. Review the schedule and try again.')
  }
  if (option === 'full') return { option, courtRate, serviceFee, total, amountToPayNow: total, remainingBalance: 0 }
  if (option !== 'half') throw new Error('Choose full payment or a 50% downpayment.')
  const firstRentalPayment = roundMoney(courtRate / 2)
  const amountToPayNow = roundMoney(firstRentalPayment + serviceFee)
  return {
    option,
    courtRate,
    serviceFee,
    total,
    amountToPayNow,
    remainingBalance: roundMoney(total - amountToPayNow),
  }
}
