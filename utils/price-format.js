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

module.exports = { formatPriceAmount };
