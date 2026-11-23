const { formatMarketPrice } = require('../../utils/price-format');
const itemRouter = require('../../utils/item-router');
const marketCloud = require('../../utils/market-cloud');

const FEED_REFRESH_INTERVAL = 60 * 1000;

Page({
  data: {
    failedCovers: {},
    searchKeyword: '',
    showSearchPanel: false,
    suggestions: [],
    hotKeywords: ['二手车','iPhone','搬家','接机','MacBook','租房','Switch','自行车'],
    searchHistory: [],
    recommendList: [],
    displayList: [],
    feedLoading: false,
    feedError: '',
    searchEmpty: false,
    kingkongRow1: [
      { id: 1, iconPath: '/assets/icons/home/pickup.svg', name: '接机', type: 'pickup', bgColor: '#EAF3FF' },
      { id: 2, iconPath: '/assets/icons/home/moving.svg', name: '搬家', type: 'moving', bgColor: '#FFF2E8' },
      { id: 3, iconPath: '/assets/icons/home/job.svg', name: '找工', type: 'job', bgColor: '#F0EEFF' },
      { id: 4, iconPath: '/assets/icons/home/secondhand.svg', name: '二手集市', type: 'secondhand', bgColor: '#FFECEF' }
    ],
    kingkongRow2: [
      { id: 5, iconPath: '/assets/icons/home/rent.svg', name: '租房', type: 'rent', bgColor: '#EFEEFF' },
      { id: 6, iconPath: '/assets/icons/home/party.svg', name: '组局', type: 'party', bgColor: '#FFF4E5' },
      { id: 7, iconPath: '/assets/icons/home/help.svg', name: '求助', type: 'help', bgColor: '#E9FAF3' },
      { id: 8, iconPath: '/assets/icons/home/local.svg', name: '本地服务', type: 'local', bgColor: '#E7F8F5' }
    ],
    hotServices: [
      { id: 1, type: 'pickup', icon: '✈️', title: '机场接送', desc: '安全准时', bgColor: '#E8F4FD' },
      { id: 2, type: 'moving', icon: '🚚', title: '学生搬家', desc: '价格实惠', bgColor: '#FFF3E8' },
      { id: 3, type: 'job', icon: '💼', title: '兼职找工', desc: '靠谱岗位', bgColor: '#E8F8E8' }
    ],
    infoList: []
  },

  onCoverError(e) {
    const key = e.currentTarget.dataset.key;
    if (key) this.setData({ failedCovers: { ...this.data.failedCovers, [key]: e.currentTarget.dataset.retry ? 1 : 2 } });
  },

  onLoad() {
    this.loadHistory();
    const cached = marketCloud.getCachedItems(0, 12);
    if (cached && cached.items && cached.items.length) this.applyMarketItems(cached.items);
    const freshCache = marketCloud.getCachedItems(0, 12, FEED_REFRESH_INTERVAL);
    if (!freshCache) this.loadMarketItems(!!cached);
  },

  retryFeed() { this.loadMarketItems(false); },
  onOpenSafety() {
    wx.navigateTo({ url: '/pages/policies/index?type=safety' });
  },
  onShow() {
    if (this._marketLoaded && getApp().globalData.marketNeedsRefresh) this.loadMarketItems();
    else if (this._marketLoaded && Date.now() - Number(this._lastMarketRefreshAt || 0) > FEED_REFRESH_INTERVAL) this.loadMarketItems(true);
    else this.genRec();
  },

  applyMarketItems(rows) {
    const infoList = rows.map(item => ({ ...item, campusPrice: formatMarketPrice(item.price) }));
    this._marketLoaded = true;
    this._lastMarketRefreshAt = Date.now();
    this.setData({ failedCovers: {}, feedError: '', infoList, displayList: infoList.slice(0, 4), searchEmpty: false });
    getApp().globalData._infoItems = infoList;
    this.genRec();
  },
  async loadMarketItems(background) {
    if (this._readingFeed) return;
    this._readingFeed = true;
    if (!background) this.setData({ feedLoading: true });
    try {
      const result = await marketCloud.listItems(0, 12);
      this.applyMarketItems(result.items);
    } catch (error) {
      if (background && this.data.infoList.length) return;
      this._marketLoaded = true;
      this.setData({ feedError: marketCloud.getErrorMessage(error), infoList: [], displayList: [], recommendList: [] });
    } finally {
      this._readingFeed = false;
      this.setData({ feedLoading: false });
    }
  },

  onSearchFocus() {
    this.loadHistory();
    this.setData({ showSearchPanel: true });
  },
  onCloseSearchPanel() {
    this.setData({ showSearchPanel: false });
    wx.hideKeyboard();
  },
  onCancelSearch() {
    this.setData({
      searchKeyword: '',
      showSearchPanel: false,
      suggestions: [],
      displayList: this.data.infoList,
      searchEmpty: false
    });
    wx.hideKeyboard();
  },

  onSearchInput(e) {
    const value = e.detail.value;
    const kw = value.trim();
    this.setData({ searchKeyword: value, showSearchPanel: true });
    if (!kw) { this.setData({ suggestions: [], displayList: this.data.infoList, searchEmpty: false }); return; }
    const l = kw.toLowerCase();
    const f = this.data.infoList.filter((item) => {
      const searchableText = [item.title, item.category, item.nickname, item.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchableText.includes(l);
    });
    this.setData({ displayList: f, searchEmpty: f.length === 0 });
    const pool = [...new Set([
      ...this.data.infoList.map(item => item.title),
      ...this.data.infoList.map(item => item.category),
      ...this.data.hotKeywords,
      '机场接机', '学生搬家', '兼职', 'City公寓', '免费赠送', '本地服务'
    ])];
    this.setData({ suggestions: pool.filter(t => t.toLowerCase().includes(l)).slice(0, 6) });
  },

  onSearchConfirm(e) {
    const kw = ((e.detail && e.detail.value) || this.data.searchKeyword).trim();
    if (!kw) return;
    this.setData({ showSearchPanel: false }); this.saveH(kw);
    wx.hideKeyboard();
    wx.navigateTo({ url: '/pages/search/result?keyword=' + encodeURIComponent(kw) });
  },

  onTapSuggestion(e) {
    const kw = e.currentTarget.dataset.keyword;
    this.setData({ searchKeyword: kw, showSearchPanel: false }); this.saveH(kw);
    wx.hideKeyboard();
    wx.navigateTo({ url: '/pages/search/result?keyword=' + encodeURIComponent(kw) });
  },

  onClearSearch() {
    this.setData({ searchKeyword: '', displayList: this.data.infoList, searchEmpty: false, suggestions: [], showSearchPanel: true });
  },

  loadHistory() { const h = wx.getStorageSync('searchHistory') || []; this.setData({ searchHistory: h.slice(0, 8) }); },
  saveH(kw) {
    let h = wx.getStorageSync('searchHistory') || []; h = h.filter(x => x !== kw); h.unshift(kw);
    if (h.length > 20) h.pop(); wx.setStorageSync('searchHistory', h); this.setData({ searchHistory: h.slice(0, 8) });
  },
  onClearHistory() { wx.setStorageSync('searchHistory', []); this.setData({ searchHistory: [] }); },

  genRec() {
    const h = wx.getStorageSync('searchHistory') || [];
    const recommendItems = this.data.infoList.slice();
    getApp().globalData._recommendItems = recommendItems;
    if (h.length === 0) {
      const s = [...recommendItems].sort(() => Math.random() - 0.5);
      this.setData({ recommendList: s.slice(0, 4) }); return;
    }
    const last = h[0].toLowerCase();
    const m = recommendItems.filter(r => r.title.toLowerCase().includes(last) || r.category.toLowerCase().includes(last));
    const o = recommendItems.filter(r => !m.includes(r)).sort(() => Math.random() - 0.5);
    this.setData({ recommendList: [...m, ...o].slice(0, 5) });
  },
  onRefreshRecommend() { this.genRec(); wx.showToast({ title: '已刷新', icon: 'none' }); },

  onKingkongTap(e) {
    const t = e.currentTarget.dataset.type;
    if (t === 'secondhand') {
      wx.switchTab({ url: '/pages/market/list/list' });
    } else if (t === 'rent') {
      getApp().globalData.helpTabType = 'rent';
      wx.switchTab({ url: '/pages/help/index/index' });
    } else if (t === 'local') {
      getApp().globalData.helpTabType = 'all';
      wx.switchTab({ url: '/pages/help/index/index' });
    } else if (['pickup', 'moving', 'job', 'party', 'help'].includes(t)) {
      getApp().globalData.helpTabType = t;
      wx.switchTab({ url: '/pages/help/index/index' });
    } else {
      wx.showToast({ title: '功能开发中', icon: 'none' });
    }
  },
  onHotServiceTap(e) {
    const type = e.currentTarget.dataset.type || 'pickup';
    getApp().globalData.helpTabType = type;
    wx.switchTab({ url: '/pages/help/index/index' });
  },
  openPublish() { wx.navigateTo({ url: '/pages/publish/index' }); },
  openMessages() { wx.navigateTo({ url: '/pages/mine/messages/index' }); },
  onInfoTap(e) {
    itemRouter.navigateToDetail(e.currentTarget.dataset.item);
  },
  async onPullDownRefresh() { await this.loadMarketItems(); wx.stopPullDownRefresh(); }
})
