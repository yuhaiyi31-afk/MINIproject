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

function findViolation(item) {
  const content = normalize([
    item && item.title,
    item && item.description,
    item && item.category,
    item && item.subCategory
  ].filter(Boolean).join(' '));
  return RULES.find(rule => rule.keywords.some(keyword => content.includes(normalize(keyword)))) || null;
}

function getValidationMessage(item) {
  const violation = findViolation(item);
  return violation ? `内容可能涉及禁售范围（${violation.label}），请修改后再发布` : '';
}

module.exports = { findViolation, getValidationMessage };
