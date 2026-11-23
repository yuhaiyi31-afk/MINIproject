const { createWechatTrade } = require('../trade-client');

Page({
  data: {
    ready: false, busy: false, notice: '', linked: false, itemId: '',
    mode: '', invite: '', confirmation: '', conversations: [], conversationId: '', messages: [], draft: '', notifications: [],
    favorites: [], favoritesOffset: 0, favoritePagesLeft: false, service: false, blocked: false,
    reportReasons: ['疑似诈骗', '禁售或违法物品', '虚假描述', '侵权或仿冒', '骚扰或不当行为', '其他'],
    reportReason: '', reportDetail: '', blockedUsers: []
  },

  onLoad(options) {
    try {
      this.environmentId = options.env;
      this.call = createWechatTrade(wx.cloud, options.env);
      this.setData({ ready: true, itemId: options.itemId || '', service: options.publishType === 'service' });
      this.readStatus();
    } catch (error) {
      this.setData({ notice: error.message });
    }
  },

  openItems() {
    const suffix = this.data.service ? '&publishType=service' : '';
    wx.navigateTo({ url: '/pages/items?env=' + encodeURIComponent(this.environmentId) + suffix });
  },

  async run(operation) {
    if (!this.data.ready || this.data.busy) return;
    this.setData({ busy: true, notice: '' });
    try {
      await operation();
    } catch (error) {
      this.setData({ notice: error.message || '操作失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  readStatus() {
    return this.run(async () => {
      const { linked } = await this.call('identity.status');
      this.setData({ linked });
    });
  },

  start(event) {
    const { mode } = event.currentTarget.dataset;
    return this.run(async () => {
      const { invite } = await this.call('identity.start', { mode });
      this.setData({ mode, invite, confirmation: '' });
    });
  },

  copyInvite() {
    wx.setClipboardData({ data: this.data.invite });
  },

  enterConfirmation(event) {
    this.setData({ confirmation: event.detail.value });
  },

  confirm() {
    return this.run(async () => {
      const { mode, confirmation } = this.data;
      const { linked } = await this.call('identity.confirm', { mode, confirmation: confirmation.trim() });
      this.setData({ linked, invite: '', confirmation: '', mode: '', notice: linked ? '绑定完成' : '解绑完成' });
    });
  },

  enterItem(event) {
    this.setData({ itemId: event.detail.value, blocked: false });
  },

  readFavorite() {
    return this.run(async () => {
      const { favorited } = await this.call('favorites.get', { itemId: this.data.itemId.trim() });
      this.setData({ notice: favorited ? '已收藏' : '未收藏' });
    });
  },

  setFavorite(event) {
    const favorited = event.currentTarget.dataset.operation === 'add';
    return this.run(async () => {
      await this.call('favorites.set', { itemId: this.data.itemId.trim(), favorited });
      this.setData({ notice: favorited ? '已收藏' : '已取消收藏' });
    });
  },

  async readFavorites(offset) {
    const { items, page } = await this.call('favorites.list', { offset });
    this.setData({
      favorites: offset ? [...this.data.favorites, ...items] : items,
      favoritesOffset: page.nextOffset, favoritePagesLeft: page.hasMore
    });
  },

  loadFavorites() { return this.run(() => this.readFavorites(0)); },

  loadMoreFavorites() { return this.run(() => this.readFavorites(this.data.favoritesOffset)); },

  chooseFavorite(event) { this.setData({ itemId: event.currentTarget.dataset.id }); },

  confirmSold() {
    const itemId = this.data.itemId.trim();
    return this.run(async () => {
      const item = await this.call('items.getOwned', { itemId });
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '标记已售',
        content: `将「${item.title}」从三端的在售列表移除。`,
        success: ({ confirm }) => resolve(confirm),
        fail: () => resolve(false)
      }));
      if (!confirmed) return;
      await this.call('items.markSold', { itemId, revision: item.revision });
      this.setData({ notice: '已标记为已售' });
    });
  },

  loadChats() {
    return this.run(async () => {
      const { conversations } = await this.call('chat.list');
      this.setData({ conversations, notice: conversations.length ? '' : '暂无测试会话' });
    });
  },

  async readMessages(conversationId) {
    const { messages } = await this.call('chat.get', { conversationId });
    this.setData({ messages, conversationId, ...(conversationId !== this.data.conversationId ? { draft: '' } : {}) });
  },

  openChat(event) {
    const { id } = event.currentTarget.dataset;
    return this.run(() => this.readMessages(id));
  },

  startChat() {
    return this.run(async () => {
      const chat = await this.call('chat.ensure', { itemId: this.data.itemId.trim(), publishType: this.data.service ? 'service' : 'market' });
      await this.readMessages(chat.id);
    });
  },

  selectReason(event) {
    this.setData({ reportReason: this.data.reportReasons[Number(event.detail.value)] });
  },

  enterReportDetail(event) { this.setData({ reportDetail: event.detail.value }); },

  submitReport(event) {
    return this.run(async () => {
      const { itemId, reportReason, reportDetail } = this.data;
      await this.call('reports.submit', {
        itemId: itemId.trim(), targetType: event.currentTarget.dataset.type, reason: reportReason, detail: reportDetail
      });
      this.setData({ notice: '举报已提交', reportDetail: '', reportReason: '' });
    });
  },

  readRelationship() {
    return this.run(async () => {
      const { blocked } = await this.call('blocks.relationship', { itemId: this.data.itemId.trim() });
      this.setData({ blocked, notice: blocked ? '此发布者已拉黑' : '未拉黑此发布者' });
    });
  },

  toggleBlock(event) {
    const blocked = event.currentTarget.dataset.action === 'block';
    return this.run(async () => {
      await this.call('blocks.toggle', { itemId: this.data.itemId.trim(), blocked });
      this.setData({ blocked, notice: blocked ? '已拉黑发布者' : '已取消拉黑' });
    });
  },

  loadBlocked() {
    return this.run(async () => {
      const { users } = await this.call('blocks.list');
      this.setData({ blockedUsers: users, notice: users.length ? '' : '暂无拉黑用户' });
    });
  },

  unblock(event) {
    const { id } = event.currentTarget.dataset;
    return this.run(async () => {
      await this.call('blocks.toggle', { userId: id, blocked: false });
      this.setData({ blockedUsers: this.data.blockedUsers.filter(user => user.id !== id), notice: '已取消拉黑' });
    });
  },

  markRead() {
    return this.run(async () => {
      await this.call('chat.markRead', { conversationId: this.data.conversationId });
      this.setData({ notice: '会话已标记为已读' });
    });
  },

  async readNotifications() {
    const { notifications } = await this.call('notifications.list');
    this.setData({ notifications, notice: notifications.length ? '' : '暂无测试通知' });
  },

  loadNotifications() {
    return this.run(() => this.readNotifications());
  },

  markNotification(event) {
    return this.run(async () => {
      await this.call('notifications.markRead', { notificationId: event.currentTarget.dataset.id });
      await this.readNotifications();
    });
  },

  enterDraft(event) {
    this.setData({ draft: event.detail.value });
  },

  send() {
    return this.run(async () => {
      const { conversationId, draft } = this.data;
      const text = draft.trim();
      const pendingKey = JSON.stringify([conversationId, text]);
      if (this.pendingKey !== pendingKey) {
        this.pendingKey = pendingKey;
        this.pendingId = `send_${Date.now()}_${Math.floor(Math.random() * 1000000000)}`;
      }
      await this.call('chat.send', { conversationId, text, requestId: this.pendingId });
      this.pendingKey = '';
      this.pendingId = '';
      this.setData({ draft: '' });
      await this.readMessages(conversationId);
    });
  }
});
