const { formatMarketPrice } = require('../../../utils/price-format');
const messageCloud = require('../../../utils/message-cloud');
const itemRouter = require('../../../utils/item-router');
const marketCloud = require('../../../utils/market-cloud');
const adminCloud = require('../../../utils/admin-cloud');
const userCloud = require('../../../utils/user-cloud');

function isAvatarImage(value) {
  const source = String(value || '').trim();
  return /^(https?:\/\/|cloud:\/\/|wxfile:\/\/|file:\/\/|\/)/i.test(source)
    || /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(source);
}

function getSellerState(item) {
  const sellerName = String(item.publisherNick || item.nickname || '匿名用户').trim() || '匿名用户';
  const avatar = item.publisherAvatar || item.avatar || '';
  return {
    sellerName,
    sellerAvatarUrl: isAvatarImage(avatar) ? avatar : '',
    sellerInitial: sellerName.slice(0, 1)
  };
}

Page({
  data: {
    item: {},
    showReport: false,
    reportReasons: ['诈骗', '违禁品', '虚假信息', '骚扰', '其他'],
    reportTargetType: 'item',
    reasonIdx: 0,
    reportDetail: '',
    reportBusy: false,
    isFavorited: false,
    favoriteBusy: false,
    currentImageIndex: 0,
    sellerName: '匿名用户',
    sellerAvatarUrl: '',
    sellerInitial: '用',
    showDescription: false,
    videoActivated: false,
    ownershipResolved: false,
    isOwner: false,
    chatBusy: false,
    ownerActionBusy: false,
    sellerBlocked: false,
    relationshipBusy: false,
    loading: true,
    loadError: ''
  },

  async onLoad(options) {
    this._detailOptions = options;
    var rawId = '';
    try { rawId = options.id ? decodeURIComponent(options.id) : ''; } catch (e) { rawId = options.id || ''; }
    var id = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
    var itemType = options.itemType || '';
    var source = '';
    try { source = options.source ? decodeURIComponent(options.source) : ''; } catch (e) { source = options.source || ''; }
    let item = this.findItem(id, itemType, source);
    if (item) this.showItem(item, true);
    if (id && (source === 'cloud' || !source || typeof id === 'string')) {
      try {
        // 详情页必须实时由云端判断是否为卖家本人，不使用旧身份缓存。
        const cloudItem = await marketCloud.getItem(String(id), { forceRefresh: true });
        if (cloudItem) {
          item = cloudItem;
          itemRouter.cacheItem(item, 'cloud');
          this.showItem(item);
          return;
        }
      } catch (error) {
        if (item) return;
        this.setData({ loading: false, loadError: marketCloud.getErrorMessage(error) });
        return;
      }
    }
    if (!item) {
      this.setData({ loading: false, loadError: '该内容不存在或已下架' });
      return;
    }
    this.showItem(item);
  },

  retryDetail() { this.setData({ loading: true, loadError: '' }); this.onLoad(this._detailOptions || {}); },

  showItem(item, cached) {
    const title = String(item.title || '').trim();
    const description = String(item.description || '').trim();
    this.setData({
      item: { ...item, campusPrice: formatMarketPrice(item.price) },
      currentImageIndex: 0,
      showDescription: !!description && description !== title,
      ownershipResolved: !cached || typeof item.isOwner === 'boolean',
      isOwner: item.isOwner === true,
      loading: false,
      loadError: '',
      ...getSellerState(item)
    });
    wx.setNavigationBarTitle({ title: item.itemType === 'service' ? '服务详情' : '商品详情' });
    if (!cached) {
      this.checkFavorite(item);
      if (!item.isOwner) this.checkRelationship(item);
    }
  },

  findItem: function(id, itemType, source) {
    return itemRouter.resolveItem(id, itemType, source);
  },

  onSwiperChange(e) {
    this.setData({ currentImageIndex: Number(e.detail.current) || 0 });
  },

  onPreviewImage(e) {
    const images = Array.isArray(this.data.item.images)
      ? this.data.item.images.filter(Boolean)
      : [];
    if (!images.length) return;
    wx.previewImage({
      current: e.currentTarget.dataset.src || images[0],
      urls: images
    });
  },

  onActivateVideo() {
    if (!this.data.item.videoPath || this.data.videoActivated) return;
    this.setData({ videoActivated: true });
  },

  runWithLogin(callback) {
    const user = wx.getStorageSync('userInfo') || {};
    if (userCloud.isSignedIn(user)) {
      callback();
      return;
    }
    wx.showModal({
      title: '请先登录',
      content: '请先绑定微信手机号并登录，之后才能收藏、发送购买意向或与卖家聊天。',
      confirmText: '去登录',
      success: (res) => {
        if (res.confirm) wx.reLaunch({ url: '/pages/auth/index' });
      }
    });
  },

  onStartChat() {
    if (!this.data.ownershipResolved || this.data.chatBusy) return;
    if (this.data.isOwner) {
      wx.showToast({ title: '这是你自己的发布', icon: 'none' });
      return;
    }
    this.runAfterSafetyNotice(() => this.startChatSession());
  },

  startChatSession() {
    this.runWithLogin(async () => {
      this.setData({ chatBusy: true });
      wx.showLoading({ title: '正在建立会话…', mask: true });
      try {
        const conversation = await messageCloud.ensureConversation(this.data.item);
        if (!conversation || !conversation.id) throw new Error('会话创建失败，请重试');
        wx.navigateTo({
          url: `/pages/chat/index?conversationId=${encodeURIComponent(conversation.id)}`,
          fail: () => wx.showToast({ title: '无法打开聊天页，请重试', icon: 'none' })
        });
      } catch (error) {
        wx.showModal({ title: '暂时无法聊天', content: messageCloud.getErrorMessage(error), showCancel: false });
      } finally {
        wx.hideLoading();
        this.setData({ chatBusy: false });
      }
    });
  },

  runAfterSafetyNotice(callback) {
    const key = 'marketContactSafetyReadV1';
    if (wx.getStorageSync(key)) {
      callback();
      return;
    }
    wx.showModal({
      title: '交易安全提示',
      content: '请确认商品合法合规，验货后付款，勿提前转账。',
      confirmText: '我知道了',
      cancelText: '暂不联系',
      success: result => {
        if (!result.confirm) return;
        wx.setStorageSync(key, true);
        callback();
      }
    });
  },

  onEditOwnItem() {
    if (!this.data.isOwner || this.data.ownerActionBusy) return;
    const id = this.data.item.id || this.data.item._id;
    wx.navigateTo({ url: `/pages/publish/index?editId=${encodeURIComponent(id)}` });
  },

  onUnlistOwnItem() {
    if (!this.data.isOwner || this.data.ownerActionBusy || this.data.item.status !== 'active') return;
    wx.showModal({
      title: '确认下架？',
      content: '下架后不再公开展示，商品资料和图片会保留。',
      confirmText: '下架',
      confirmColor: '#D94A4A',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ ownerActionBusy: true });
        wx.showLoading({ title: '下架中…', mask: true });
        try {
          await marketCloud.unlistItem(this.data.item.id || this.data.item._id);
          getApp().globalData.marketNeedsRefresh = true;
          getApp().globalData.serviceNeedsRefresh = true;
          this.setData({ 'item.status': 'unlisted' });
          wx.showToast({ title: '已下架', icon: 'success' });
        } catch (error) {
          wx.showModal({ title: '下架失败', content: marketCloud.getErrorMessage(error), showCancel: false });
        } finally {
          wx.hideLoading();
          this.setData({ ownerActionBusy: false });
        }
      }
    });
  },

  onMarkSoldOwnItem() {
    this.changeOwnItemStatus('sold', '确认已经售出？', '标记已售后商品会从公开集市隐藏，之后仍可重新上架。', '已标记售出');
  },

  onRelistOwnItem() {
    this.changeOwnItemStatus('active', '确认重新上架？', '请先确认商品信息、价格和图片仍然准确。', '已重新上架');
  },

  changeOwnItemStatus(status, title, content, successTitle) {
    if (!this.data.isOwner || this.data.ownerActionBusy) return;
    wx.showModal({
      title,
      content,
      confirmColor: status === 'sold' ? '#27865A' : '#3478C9',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ ownerActionBusy: true });
        wx.showLoading({ title: '处理中…', mask: true });
        try {
          await marketCloud.setItemStatus(this.data.item.id || this.data.item._id, status);
          getApp().globalData.marketNeedsRefresh = true;
          this.setData({ 'item.status': status });
          wx.showToast({ title: successTitle, icon: 'success' });
        } catch (error) {
          wx.showModal({ title: '操作失败', content: marketCloud.getErrorMessage(error), showCancel: false });
        } finally {
          wx.hideLoading();
          this.setData({ ownerActionBusy: false });
        }
      }
    });
  },

  onOpenOwnManage() {
    if (this.data.isOwner) wx.navigateTo({ url: '/pages/mine/publish-list/index' });
  },

  onWantBuy() {
    this.runAfterSafetyNotice(() => this.sendPurchaseIntent());
  },

  sendPurchaseIntent() {
    this.runWithLogin(async () => {
      wx.showLoading({ title: '正在发送…', mask: true });
      try {
        const conversation = await messageCloud.createPurchaseIntent(this.data.item);
        wx.hideLoading();
        wx.showToast({ title: this.data.item.itemType === 'service' ? '需求已发送' : '购买意向已发送', icon: 'success' });
        wx.navigateTo({
          url: `/pages/chat/index?conversationId=${encodeURIComponent(conversation.id)}`
        });
      } catch (error) {
        wx.hideLoading();
        wx.showModal({ title: '发送失败', content: messageCloud.getErrorMessage(error), showCancel: false });
      }
    });
  },

  onShowReport() { this.setData({ showReport: true, reportTargetType: 'item', reasonIdx: 0, reportDetail: '' }); },
  onShowUserReport() { this.setData({ showReport: true, reportTargetType: 'user', reasonIdx: 0, reportDetail: '' }); },
  onCloseReport() { this.setData({ showReport: false }); },
  noop() {},
  onSelectReason(e) { this.setData({ reasonIdx: e.detail.value }); },
  onReportInput(e) { this.setData({ reportDetail: e.detail.value }); },

  onSubmitReport() {
    this.runWithLogin(async () => {
      if (this.data.reportBusy) return;
      this.setData({ reportBusy: true });
      wx.showLoading({ title: '正在提交…', mask: true });
      try {
        const submit = this.data.reportTargetType === 'user' ? adminCloud.submitUserReport : adminCloud.submitReport;
        await submit({
          itemId: this.data.item.id,
          reason: this.data.reportReasons[this.data.reasonIdx],
          detail: this.data.reportDetail
        });
        this.setData({ showReport: false, reportDetail: '' });
        wx.showToast({ title: '举报已提交', icon: 'success' });
      } catch (error) {
        wx.showModal({ title: '提交失败', content: adminCloud.getErrorMessage(error), showCancel: false });
      } finally {
        wx.hideLoading();
        this.setData({ reportBusy: false });
      }
    });
  },

  async checkRelationship(item) {
    const user = wx.getStorageSync('userInfo') || {};
    if (!userCloud.isSignedIn(user) || !item || item.source !== 'cloud') return;
    try {
      const relationship = await adminCloud.getRelationship(item.id);
      this.setData({ sellerBlocked: relationship.blocked });
    } catch (error) { /* 关系状态不影响商品浏览 */ }
  },

  onToggleBlockSeller() {
    this.runWithLogin(async () => {
      if (this.data.relationshipBusy) return;
      const shouldBlock = !this.data.sellerBlocked;
      if (shouldBlock) {
        const confirmed = await new Promise(resolve => wx.showModal({
          title: '确认拉黑该卖家？',
          content: '拉黑后将隐藏该卖家的发布，并阻止双方继续发送新消息。',
          confirmColor: '#D94A4A',
          success: result => resolve(!!result.confirm),
          fail: () => resolve(false)
        }));
        if (!confirmed) return;
      }
      this.setData({ relationshipBusy: true });
      try {
        const blocked = await adminCloud.setUserBlocked(this.data.item.id, shouldBlock);
        this.setData({ sellerBlocked: blocked });
        getApp().globalData.marketNeedsRefresh = true;
        wx.showToast({ title: blocked ? '已拉黑卖家' : '已取消拉黑', icon: 'none' });
      } catch (error) {
        wx.showModal({ title: '操作失败', content: adminCloud.getErrorMessage(error), showCancel: false });
      } finally {
        this.setData({ relationshipBusy: false });
      }
    });
  },

  async checkFavorite(item) {
    if (item.source !== 'cloud') return;
    try {
      this.setData({ isFavorited: await marketCloud.isFavorited(item.id) });
    } catch (error) {
      this.setData({ isFavorited: false });
    }
  },

  onToggleFavorite() {
    this.runWithLogin(async () => {
      if (this.data.favoriteBusy) return;
      const item = this.data.item;
      const favorited = !this.data.isFavorited;
      this.setData({ favoriteBusy: true });
      try {
        await marketCloud.toggleFavorite(item.id, favorited);
        if (favorited) {
          messageCloud.notifyFavorite(item).catch(error => {
            wx.showToast({ title: messageCloud.getErrorMessage(error), icon: 'none', duration: 2500 });
          });
          wx.showToast({ title: '已加入收藏', icon: 'success' });
        } else {
          wx.showToast({ title: '已取消收藏', icon: 'none' });
        }
        wx.vibrateShort({ type: 'light' });
        this.setData({ isFavorited: favorited });
      } catch (error) {
        wx.showToast({ title: marketCloud.getErrorMessage(error), icon: 'none' });
      } finally {
        this.setData({ favoriteBusy: false });
      }
    });
  },

  onShareAppMessage() {
    const item = this.data.item || {};
    const id = item.id || item._id || '';
    return {
      title: item.title || '奥克兰留学生小助手',
      path: `/pages/market/detail/index?id=${encodeURIComponent(id)}&itemType=${item.itemType || 'product'}&source=cloud`,
      imageUrl: Array.isArray(item.images) && item.images.length ? item.images[0] : ''
    };
  },

  onShareTimeline() {
    const item = this.data.item || {};
    const id = item.id || item._id || '';
    return {
      title: item.title || '奥克兰留学生小助手',
      query: `id=${encodeURIComponent(id)}&itemType=${item.itemType || 'product'}&source=cloud`,
      imageUrl: Array.isArray(item.images) && item.images.length ? item.images[0] : ''
    };
  }
})
