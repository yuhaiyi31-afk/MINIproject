function trimNumber(value, decimals) {
  const output = Number(value).toFixed(decimals);
  return decimals > 0 ? output.replace(/\.?0+$/, '') : output;
}

function formatPriceAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  if (amount >= 999 * 1e12) return '999T+';
  const units = [
    { value: 1e12, suffix: 'T' },
    { value: 1e9, suffix: 'B' },
    { value: 1e6, suffix: 'M' }
  ];
  const unit = units.find(entry => amount >= entry.value);
  if (unit) {
    const scaled = amount / unit.value;
    return `${trimNumber(scaled, scaled < 10 ? 1 : 0)}${unit.suffix}`;
  }
  if (amount < 0.01) return '0.01';
  return trimNumber(Math.round(amount * 100) / 100, 2);
}

function formatMarketPrice(value) {
  if (value == null || String(value).trim() === '') return '价格待确认';
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return '价格待确认'
  if (amount == 0) return '免费'
  const parts = amount.toFixed(2).split('.')
  const digits = parts[0]
  let grouped = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) grouped += ','
    grouped += digits.charAt(i)
  }
  const cents = parts.length > 1 && parts[1] != '00' ? '.' + parts[1] : ''
  return 'NZ$ ' + grouped + cents
}

module.exports = { formatPriceAmount, formatMarketPrice };
