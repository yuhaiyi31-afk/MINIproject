// 多语言接口 - 保留扩展接口
const LANG_PACKS = {
  'zh-CN': {
    appName: '奥克兰留学生小助手',
    search: '搜索接机、搬家、二手...',
    home: '首页',
    market: '集市',
    service: '服务大厅',
    mine: '我的',
    publish: '发布',
    price: 'NZ$',
    free: '免费',
    contact: '联系',
    report: '举报',
    favorite: '收藏',
    pin: '置顶',
    points: '积分',
    hoursAgo: '小时前',
    daysAgo: '天前',
    justNow: '刚刚'
  },
  'en': {
    appName: 'AKL Student Helper',
    search: 'Search pickup, moving, second-hand...',
    home: 'Home',
    market: 'Market',
    service: 'Services',
    mine: 'Me',
    publish: 'Post',
    price: 'NZ$',
    free: 'Free',
    contact: 'Contact',
    report: 'Report',
    favorite: 'Favorite',
    pin: 'Pin',
    points: 'Points',
    hoursAgo: 'h ago',
    daysAgo: 'd ago',
    justNow: 'Just now'
  }
};

let currentLang = 'zh-CN';

function setLang(lang) {
  if (LANG_PACKS[lang]) {
    currentLang = lang;
    wx.setStorageSync('appLang', lang);
  }
}

function getLang() {
  const saved = wx.getStorageSync('appLang') || 'zh-CN';
  currentLang = saved;
  return saved;
}

function t(key) {
  getLang();
  const pack = LANG_PACKS[currentLang] || LANG_PACKS['zh-CN'];
  return pack[key] || key;
}

function formatTime(timeStr) {
  // 已经是中文格式，如果是英文环境转换
  if (currentLang === 'en') {
    return timeStr
      .replace('小时前', 'h ago')
      .replace('天前', 'd ago')
      .replace('刚刚', 'Just now');
  }
  return timeStr;
}

module.exports = { setLang, getLang, t, formatTime, LANG_PACKS };