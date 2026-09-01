const RULES = [
  { label: '毒品', keywords: ['毒品', '冰毒', '海洛因', '可卡因', '芬太尼', '大麻出售', 'meth for sale', 'cocaine', 'heroin'] },
  { label: '非法武器或弹药', keywords: ['枪支', '手枪', '步枪', '子弹出售', '弹药出售', '电击枪', '甩棍', '指虎', 'firearm', 'ammunition', 'taser'] },
  { label: '处方药', keywords: ['处方药', '处方药出售', 'prescription medicine', 'prescription drug'] },
  { label: '盗窃物', keywords: ['赃物', '偷来的', '盗窃物', 'stolen goods'] },
  { label: '假证件', keywords: ['假证件', '假护照', '假驾照', '伪造证件', 'fake passport', 'fake licence', 'fake license'] },
  { label: '仿冒商品', keywords: ['明显仿冒', '高仿出售', '假货出售', 'counterfeit'] },
  { label: '色情或违法服务', keywords: ['色情服务', '性服务', '卖淫', '援交', 'prostitution', 'sexual service'] }
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_.,，。!！?？/\\]+/g, '');
}

function assertAllowed(item) {
  const content = normalize([item.title, item.description, item.category, item.subCategory].filter(Boolean).join(' '));
  const violation = RULES.find(rule => rule.keywords.some(keyword => content.includes(normalize(keyword))));
  if (violation) throw new Error(`该内容仍涉及禁售范围（${violation.label}），不能恢复`);
}

module.exports = { assertAllowed };
