const messageCloud = require('../../../utils/message-cloud');
const itemRouter = require('../../../utils/item-router');
const timeFormat = require('../../../utils/time-format');

const MESSAGE_REFRESH_INTERVAL = 15 * 1000;

function getConversationRole(conversation) {
  return conversation.currentUserRole === 'seller' ? 'seller' : 'buyer';
}

function buildMessageView(data, filter) {
  const conversations = Array.isArray(data.conversations) ? data.conversations : [];
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  const notificationCards = notifications.map(entry => ({
    id: `cloud_notification_${entry.id}`,
    sourceId: entry.id,
    mode: 'cloud',
    kind: 'notification',
    type: entry.type,
    icon: entry.type === 'favorite' ? '❤️' : '🛍️',
    title: entry.text,
    subtitle: entry.itemTitle,
    preview: entry.type === 'favorite' ? '有人对你的发布感兴趣' : '点击后可立即沟通',
    timestamp: entry.createdAt,
    timeText: timeFormat.formatRelativeTime(entry.createdAt),
    read: !!entry.read,
    itemId: entry.itemId,
    itemType: entry.itemType,
    itemSource: entry.itemSource || 'cloud',
    itemSnapshot: entry.itemSnapshot || null,
    conversationId: entry.conversationId || '',
    currentRole: 'seller',
    avatar: entry.fromAvatar || ''
  }));
  const conversationCards = conversations.map(entry => {
    const currentRole = getConversationRole(entry);
    const isSeller = currentRole === 'seller';
    return {
      id: `cloud_conversation_${entry.id}`,
      sourceId: entry.id,
      mode: 'cloud',
      kind: 'conversation',
      type: 'chat',
      icon: '💬',
      title: isSeller ? (entry.buyerName || '买家') : (entry.sellerName || '卖家'),
      subtitle: entry.itemTitle,
      preview: entry.lastMessage || '开始聊天',
      timestamp: entry.updatedAt,
      timeText: timeFormat.formatRelativeTime(entry.updatedAt),
      unreadCount: Math.max(0, Number(isSeller ? entry.unreadForSeller : entry.unreadForBuyer) || 0),
      read: isSeller ? !(entry.unreadForSeller > 0) : !(entry.unreadForBuyer > 0),
      itemId: entry.itemId,
      itemType: entry.itemType,
      conversationId: entry.id,
      currentRole,
      avatar: isSeller ? (entry.buyerAvatar || '') : (entry.sellerAvatar || '')
    };
  });
  const all = notificationCards.concat(conversationCards)
    .sort((left, right) => right.timestamp - left.timestamp);
  const cards = filter && filter !== 'all' ? all.filter(entry => entry.type === filter) : all;
  const unread = notificationCards.filter(entry => !entry.read).length
    + conversationCards.filter(entry => !entry.read).length;
  return {
    cards,
    stats: {
      chat: conversations.length,
      purchase: notifications.filter(entry => entry.type === 'purchase').length,
      favorite: notifications.filter(entry => entry.type === 'favorite').length,
      unread
    }
  };
}

Page({
  data: {
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'chat', label: '聊天' },
      { key: 'purchase', label: '想购买' },
      { key: 'favorite', label: '被收藏' }
    ],
    currentTab: 'all',
    cards: [],
    stats: { chat: 0, purchase: 0, favorite: 0, unread: 0 },
    loading: false,
    errorText: '',
    hasMore: false,
    conversationSkip: 0,
    notificationSkip: 0
  },

  onShow() {
    if (!this._allMessageData) {
      const cached = messageCloud.getCachedMessages();
      if (cached) this.applyMessagePage(cached, false);
    }
    if (!this._lastRefreshAt || Date.now() - this._lastRefreshAt > MESSAGE_REFRESH_INTERVAL) this.refreshMessages(false, !!this._allMessageData);
  },

  async onPullDownRefresh() {
    await this.refreshMessages(false);
    wx.stopPullDownRefresh();
  },

  applyMessagePage(page, append) {
    const previous = append && this._allMessageData
      ? this._allMessageData
      : { conversations: [], notifications: [] };
    const data = {
      conversations: previous.conversations.concat(page.conversations || []),
      notifications: previous.notifications.concat(page.notifications || [])
    };
    const view = buildMessageView(data, this.data.currentTab);
    this._allMessageData = data;
    this.setData({
      ...view,
      loading: false,
      hasMore: !!page.hasMore,
      conversationSkip: Number(page.conversationSkip) || 0,
      notificationSkip: Number(page.notificationSkip) || 0
    });
  },

  async refreshMessages(append, background) {
    if (this.data.loading) return;
    if (!background) this.setData({ loading: true, errorText: '' });
    try {
      const page = await messageCloud.listMessages({
        conversationSkip: append ? this.data.conversationSkip : 0,
        notificationSkip: append ? this.data.notificationSkip : 0,
        limit: 20
      });
      this._lastRefreshAt = Date.now();
      this.applyMessagePage(page, append);
    } catch (error) {
      if (background && this._allMessageData) return;
      const errorText = messageCloud.getErrorMessage(error);
      this._allMessageData = { conversations: [], notifications: [] };
      const view = buildMessageView(this._allMessageData, this.data.currentTab);
      this.setData({
        ...view,
        loading: false,
        errorText: view.cards.length ? '' : errorText,
        hasMore: false
      });
    }
  },

  openMarket() { wx.switchTab({ url: '/pages/market/list/list' }); },
  retryInbox() { this.refreshMessages(false); },
  onTabTap(e) {
    const currentTab = e.currentTarget.dataset.key;
    const view = buildMessageView(this._allMessageData || { conversations: [], notifications: [] }, currentTab);
    this.setData({ currentTab, ...view });
  },

  async onMarkAllRead() {
    try {
      await messageCloud.markAllRead();
      await this.refreshMessages(false);
      wx.showToast({ title: '已全部标为已读', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: messageCloud.getErrorMessage(error), icon: 'none' });
    }
  },

  async onCardTap(e) {
    const card = this.data.cards.find(item => item.id === e.currentTarget.dataset.id);
    if (!card) return;

    if (card.kind === 'notification' && !card.read) messageCloud.markNotificationRead(card.sourceId).catch(() => {});
    if (card.conversationId) {
      if (!card.read) messageCloud.markConversationRead(card.conversationId).catch(() => {});
      wx.navigateTo({
        url: `/pages/chat/index?conversationId=${encodeURIComponent(card.conversationId)}`
      });
      return;
    }

    if (card.itemSnapshot) {
      itemRouter.navigateToDetail(card.itemSnapshot, card.itemSource || 'cloud');
      return;
    }
    wx.navigateTo({
      url: `/pages/market/detail/index?id=${card.itemId}&itemType=${card.itemType || 'product'}&source=cloud`
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.refreshMessages(true);
  }
});
