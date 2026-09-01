const itemRouter = require('../../../utils/item-router');
const marketCloud = require('../../../utils/market-cloud');
const marketOptions = require('../../../utils/market-options');

const FEED_REFRESH_INTERVAL = 60 * 1000;
const PAGE_SIZE = 12;

Page({
  data: {
    keyword: '',
    showFilter: false,
    filterActive: false,
    filterMinPrice: '',
    filterMaxPrice: '',
    timeOptions: ['全部时间', '24小时内', '3天内', '7天内'],
    filterTimeIdx: 0,
    categoryOptions: ['全部', ...marketOptions.CATEGORIES],
    categoryIdx: 0,
    regionOptions: ['全部地区', ...marketOptions.REGIONS],
    regionIdx: 0,
    sortOptions: marketOptions.SORT_OPTIONS.map(item => item.label),
    sortIdx: 0,
    items: [],
    loading: false,
    hasMore: true,
    nextSkip: 0,
    emptyText: '暂无真实发布'
  },

  onLoad() {
    const filters = this.getFilters();
    const cached = marketCloud.getCachedBrowse(filters, 0, PAGE_SIZE);
    if (cached && cached.items && cached.items.length) {
      this.applyItems(cached, true);
      if (!marketCloud.getCachedBrowse(filters, 0, PAGE_SIZE, FEED_REFRESH_INTERVAL)) this.loadItems(true, true);
    } else {
      this.loadItems(true);
    }
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  onShow() {
    const app = getApp();
    if (this._loaded && app.globalData.marketNeedsRefresh) {
      app.globalData.marketNeedsRefresh = false;
      this.loadItems(true);
    } else if (this._loaded && Date.now() - Number(this._lastRefreshAt || 0) > FEED_REFRESH_INTERVAL) {
      this.loadItems(true, this.data.items.length > 0);
    }
  },

  getFilters() {
    const sortOption = marketOptions.SORT_OPTIONS[this.data.sortIdx] || marketOptions.SORT_OPTIONS[0];
    return {
      keyword: String(this.data.keyword || '').trim(),
      category: this.data.categoryIdx > 0 ? this.data.categoryOptions[this.data.categoryIdx] : '',
      region: this.data.regionIdx > 0 ? this.data.regionOptions[this.data.regionIdx] : '',
      minPrice: this.data.filterMinPrice,
      maxPrice: this.data.filterMaxPrice,
      days: [0, 1, 3, 7][this.data.filterTimeIdx] || 0,
      sort: sortOption.value
    };
  },

  applyItems(result, reset) {
    const items = (reset ? [] : this.data.items).concat(result.items || []);
    this._loaded = true;
    this._lastRefreshAt = Date.now();
    this.setData({
      items,
      hasMore: !!result.hasMore,
      nextSkip: Number(result.nextSkip) || 0,
      loading: false,
      emptyText: items.length ? '' : '没有找到符合条件的在售商品'
    });
    getApp().globalData._allItems = items;
  },

  async loadItems(reset, background) {
    if (this.data.loading || (!reset && !this.data.hasMore)) return;
    const requestId = reset ? Number(this._requestId || 0) + 1 : Number(this._requestId || 0);
    if (reset) this._requestId = requestId;
    if (!background) this.setData({ loading: true, emptyText: '正在读取真实发布…' });
    try {
      const result = await marketCloud.browseItems(this.getFilters(), reset ? 0 : this.data.nextSkip, PAGE_SIZE);
      if (requestId !== Number(this._requestId || 0)) return;
      this.applyItems(result, reset);
    } catch (error) {
      if (requestId !== Number(this._requestId || 0)) return;
      if (background && this.data.items.length) return;
      this._loaded = true;
      const message = marketCloud.getErrorMessage(error);
      this.setData({ loading: false, hasMore: false, items: reset ? [] : this.data.items, emptyText: message });
      wx.showToast({ title: message, icon: 'none', duration: 3000 });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || '' });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadItems(true, true), 450);
  },

  onSearchConfirm() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.loadItems(true);
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.loadItems(true);
  },

  onCategoryTap(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    if (index === this.data.categoryIdx) return;
    this.setData({ categoryIdx: index });
    this.updateFilterState();
    this.loadItems(true);
  },

  onToggleFilter() { this.setData({ showFilter: !this.data.showFilter }); },
  onFilterMinPrice(e) { this.setData({ filterMinPrice: e.detail.value }); },
  onFilterMaxPrice(e) { this.setData({ filterMaxPrice: e.detail.value }); },
  onFilterTime(e) { this.setData({ filterTimeIdx: Number(e.detail.value) || 0 }); },
  onRegionChange(e) { this.setData({ regionIdx: Number(e.detail.value) || 0 }); },
  onSortChange(e) { this.setData({ sortIdx: Number(e.detail.value) || 0 }); },

  updateFilterState() {
    const active = this.data.categoryIdx > 0
      || this.data.regionIdx > 0
      || this.data.sortIdx > 0
      || this.data.filterTimeIdx > 0
      || Number(this.data.filterMinPrice) > 0
      || this.data.filterMaxPrice !== '';
    this.setData({ filterActive: active });
  },

  onApplyFilter() {
    const min = Number(this.data.filterMinPrice) || 0;
    const hasMax = this.data.filterMaxPrice !== '';
    const max = hasMax ? Number(this.data.filterMaxPrice) : Infinity;
    if ((hasMax && !Number.isFinite(max)) || max < 0 || max < min) {
      wx.showToast({ title: '请检查价格区间', icon: 'none' });
      return;
    }
    if (this.data.sortIdx === 1 && this.data.regionIdx === 0) {
      wx.showToast({ title: '附近排序请先选择大概地区', icon: 'none' });
      return;
    }
    this.setData({ showFilter: false });
    this.updateFilterState();
    this.loadItems(true);
  },

  onClearFilter() {
    this.setData({
      filterMinPrice: '', filterMaxPrice: '', filterTimeIdx: 0,
      regionIdx: 0, sortIdx: 0, categoryIdx: 0,
      filterActive: false, showFilter: false
    });
    this.loadItems(true);
  },

  onItemTap(e) { itemRouter.navigateToDetail(e.currentTarget.dataset.item, 'cloud'); },
  onPublishTap() { wx.navigateTo({ url: '/pages/publish/index' }); },
  onPullDownRefresh() { this.loadItems(true); },
  onReachBottom() { this.loadItems(false); }
});
