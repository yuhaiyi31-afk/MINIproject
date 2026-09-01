const itemRouter = require('../../utils/item-router');
const marketCloud = require('../../utils/market-cloud');

const SYNONYM_MAP = {
  '车': ['汽车', '二手车', '自行车', '电动车', '滑板车', 'corolla'],
  '手机': ['iphone', '华为', '小米', 'samsung', 'airpods'],
  '电脑': ['笔记本', 'macbook', 'laptop', 'computer'],
  '家具': ['书桌', '办公桌', '餐桌', '床', '柜子', '椅子', '沙发'],
  '运动': ['健身', '跑步', '篮球', '网球', '足球', 'nike', 'adidas'],
  '游戏': ['switch', 'ps5', 'xbox', '桌游'],
  '教材': ['课本', '笔记', '书籍', 'nzcel', '题库'],
  '宠物': ['猫', '狗', '猫粮', '狗粮'],
  '乐器': ['吉他', '钢琴', '电子琴', 'fender', 'yamaha']
};

Page({
  data: {
    keyword: '',
    results: [],
    recommendKeywords: ['iPhone', '书桌', '教材', '自行车', 'Switch'],
    showRecommend: false,
    loading: false,
    errorText: '',
    hasMore: false,
    nextSkip: 0
  },

  onLoad(options) {
    let keyword = '';
    try { keyword = options.keyword ? decodeURIComponent(options.keyword) : ''; } catch (e) { keyword = options.keyword || ''; }
    this.setData({ keyword });
    if (keyword) {
      this.doSearch(keyword);
      this.saveSearchHistory(keyword);
    }
  },

  async doSearch(keyword, append) {
    const terms = this.expandKeyword(String(keyword || '').trim().toLowerCase());
    if (!terms.length) return;
    this.setData({ loading: true, errorText: '' });
    wx.showLoading({ title: '搜索中...', mask: false });
    try {
      const response = await marketCloud.searchItems(terms, append ? this.data.nextSkip : 0, 20);
      const scored = response.items.map(item => {
        const title = String(item.title || '').toLowerCase();
        const description = String(item.description || '').toLowerCase();
        const category = `${item.category || ''} ${item.subCategory || ''}`.toLowerCase();
        let score = 0;
        terms.forEach(term => {
          if (title === term) score += 50;
          else if (title.includes(term)) score += 30;
          if (description.includes(term)) score += 15;
          if (category.includes(term)) score += 10;
        });
        return { ...item, score: Math.min(score || 10, 100) };
      });
      const results = (append ? this.data.results.concat(scored) : scored)
        .sort((left, right) => right.score - left.score);
      getApp().globalData._searchItems = results;
      this.setData({ results, loading: false, showRecommend: results.length < 3, hasMore: response.hasMore, nextSkip: response.nextSkip });
    } catch (error) {
      this.setData({ results: append ? this.data.results : [], loading: false, hasMore: false, showRecommend: true, errorText: marketCloud.getErrorMessage(error) });
    } finally {
      wx.hideLoading();
    }
  },

  expandKeyword(keyword) {
    if (!keyword) return [];
    const terms = new Set([keyword]);
    Object.keys(SYNONYM_MAP).forEach(key => {
      const expansions = SYNONYM_MAP[key];
      if (keyword.includes(key) || expansions.some(item => item.toLowerCase().includes(keyword))) {
        terms.add(key.toLowerCase());
        expansions.forEach(item => terms.add(item.toLowerCase()));
      }
    });
    return Array.from(terms);
  },

  onSearch(e) {
    const keyword = String(e.detail.value || '').trim();
    if (!keyword) return;
    this.setData({ keyword });
    this.doSearch(keyword);
    this.saveSearchHistory(keyword);
  },

  onTapRecommend(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ keyword });
    this.doSearch(keyword);
    this.saveSearchHistory(keyword);
  },

  saveSearchHistory(keyword) {
    let history = wx.getStorageSync('searchHistory') || [];
    history = history.filter(item => item !== keyword);
    history.unshift(keyword);
    wx.setStorageSync('searchHistory', history.slice(0, 20));
  },

  onInput(e) { this.setData({ keyword: e.detail.value }); },
  onClear() { this.setData({ keyword: '', results: [], showRecommend: false, errorText: '', hasMore: false, nextSkip: 0 }); },
  onBack() { wx.navigateBack(); },
  onItemTap(e) { itemRouter.navigateToDetail(e.currentTarget.dataset.item, 'cloud'); },
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.doSearch(this.data.keyword, true);
  }
});
