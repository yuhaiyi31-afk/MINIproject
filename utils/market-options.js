const CATEGORIES = [
  '交通工具', '电子产品', '生活家居', '学习用品', '运动户外',
  '服饰美妆', '宠物用品', '乐器', '游戏娱乐', '其他'
];

const CONDITIONS = ['全新', '几乎全新', '轻微使用', '正常使用', '明显使用'];

const REGIONS = [
  'Auckland CBD', 'Central Auckland', 'North Shore', 'East Auckland',
  'West Auckland', 'South Auckland', '其他新西兰地区'
];

const DELIVERY_METHODS = ['当面交易', '买家自取', '邮寄', '双方协商'];

const SORT_OPTIONS = [
  { label: '最新发布', value: 'latest' },
  { label: '附近（同区域优先）', value: 'nearby' },
  { label: '价格从低到高', value: 'priceAsc' },
  { label: '价格从高到低', value: 'priceDesc' }
];

module.exports = {
  CATEGORIES,
  CONDITIONS,
  REGIONS,
  DELIVERY_METHODS,
  SORT_OPTIONS
};
