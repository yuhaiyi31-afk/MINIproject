const messageCloud = require('../../utils/message-cloud');
const timeFormat = require('../../utils/time-format');
const priceFormat = require('../../utils/price-format');

const POLL_FAST_INTERVAL = 4000;
const POLL_NORMAL_INTERVAL = 8000;
const POLL_IDLE_INTERVAL = 15000;
const POLL_LONG_IDLE_INTERVAL = 30000;

function renderMessage(message, conversation, currentRole) {
  const senderRole = message.senderRole || message.sender;
  return {
    ...message,
    mine: senderRole === currentRole,
    timeText: timeFormat.formatRelativeTime(message.createdAt),
    avatar: senderRole === 'buyer' ? conversation.buyerAvatar : conversation.sellerAvatar,
    fallback: senderRole === 'buyer'
      ? (conversation.buyerName || '买').slice(0, 1)
      : (conversation.sellerName || '卖').slice(0, 1)
  };
}

Page({
  data: {
    conversationId: '',
    loading: true,
    currentRole: 'buyer',
    conversation: null,
    peerLabel: '卖家',
    peerName: '',
    messages: [],
    inputValue: '',
    keyboardHeight: 0,
    sending: false,
    errorText: '',
    sendError: '',
    toView: '',
    quickMessages: ['你好，还在吗？', '可以便宜一点吗？', '什么时候方便交易？', '我今天可以取货']
  },

  async onLoad(options) {
    const conversationId = decodeURIComponent(options.conversationId || '');
    this.setData({ conversationId });
    await this.loadConversation();
  },

  async onShow() {
    this._pageVisible = true;
    if (this._hasLoadedConversation && this.data.conversationId && !this.data.loading) {
      await this.loadConversation(true);
    }
    this.schedulePoll(POLL_FAST_INTERVAL);
  },

  onHide() {
    this._pageVisible = false;
    this.stopPolling();
  },

  onUnload() {
    this._pageVisible = false;
    this.stopPolling();
  },

  onKeyboardHeightChange(e) {
    const height = Math.max(0, Number(e && e.detail && e.detail.height) || 0);
    if (height !== this.data.keyboardHeight) this.setData({ keyboardHeight: height });
    if (height > 0) {
      const last = this.data.messages[this.data.messages.length - 1];
      if (last) this.setData({ toView: `message-${last.id}` });
    }
  },

  onInputBlur() {
    if (this.data.keyboardHeight) this.setData({ keyboardHeight: 0 });
  },

  async loadConversation(silent) {
    if (!silent) this.setData({ loading: true });
    let conversation;
    try {
      conversation = await messageCloud.getConversation(this.data.conversationId);
      if (!conversation) throw new Error('会话不存在');
    } catch (error) {
      this.setData({ loading: false, errorText: messageCloud.getErrorMessage(error) });
      return;
    }

    const currentRole = conversation.currentUserRole;
    const quickMessages = currentRole === 'seller'
      ? ['你好，商品还在', '价格可以商量', '今天可以交易', '你什么时候方便？']
      : ['你好，还在吗？', '可以便宜一点吗？', '什么时候方便交易？', '我今天可以取货'];
    const unread = currentRole === 'seller'
      ? Number(conversation.unreadForSeller) || 0
      : Number(conversation.unreadForBuyer) || 0;
    if (unread > 0) messageCloud.markConversationRead(conversation.id).catch(() => {});
    const messages = (conversation.messages || []).map(message => renderMessage(message, conversation, currentRole));
    const last = messages[messages.length - 1];
    this._hasLoadedConversation = true;
    this._conversationVersion = Number(conversation.updatedAt) || Number(last && last.createdAt) || Date.now();
    this._emptyPolls = 0;
    this.setData({
      conversation: {
        ...conversation,
        campusPrice: priceFormat.formatMarketPrice(conversation.itemPrice)
      },
      messages,
      errorText: '',
      currentRole,
      quickMessages,
      peerLabel: currentRole === 'seller' ? '买家' : '卖家',
      peerName: currentRole === 'seller' ? conversation.buyerName : conversation.sellerName,
      toView: last ? `message-${last.id}` : '',
      loading: false
    });
    this.schedulePoll(POLL_FAST_INTERVAL);
  },

  stopPolling() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  },

  schedulePoll(delay) {
    this.stopPolling();
    if (!this._pageVisible || !this._hasLoadedConversation || !this.data.conversationId) return;
    this._pollTimer = setTimeout(() => this.pollForMessages(), Math.max(1000, Number(delay) || POLL_NORMAL_INTERVAL));
  },

  nextPollInterval(hasNewMessages) {
    if (hasNewMessages) return POLL_FAST_INTERVAL;
    const emptyPolls = Number(this._emptyPolls) || 0;
    if (emptyPolls <= 2) return POLL_NORMAL_INTERVAL;
    if (emptyPolls <= 8) return POLL_IDLE_INTERVAL;
    return POLL_LONG_IDLE_INTERVAL;
  },

  async pollForMessages() {
    if (!this._pageVisible || this._pollInFlight || this.data.loading || !this.data.conversationId) return;
    this._pollInFlight = true;
    let hasNewMessages = false;
    try {
      const update = await messageCloud.pollConversation(this.data.conversationId, this._conversationVersion);
      this._conversationVersion = Math.max(this._conversationVersion || 0, Number(update.updatedAt) || 0);
      const knownIds = new Set(this.data.messages.map(message => String(message.id)));
      const incoming = (update.messages || []).filter(message => !knownIds.has(String(message.id)));
      if (incoming.length) {
        const conversation = this.data.conversation || {};
        const rendered = incoming.map(message => renderMessage(message, conversation, this.data.currentRole));
        const messages = this.data.messages.concat(rendered).slice(-200);
        const last = messages[messages.length - 1];
        hasNewMessages = true;
        this._emptyPolls = 0;
        this.setData({
          messages,
          toView: last ? `message-${last.id}` : this.data.toView,
          'conversation.lastMessage': last ? last.text : conversation.lastMessage,
          'conversation.updatedAt': Number(update.updatedAt) || conversation.updatedAt
        });
      } else {
        this._emptyPolls = (Number(this._emptyPolls) || 0) + 1;
      }
    } catch (error) {
      this._emptyPolls = Math.max(3, (Number(this._emptyPolls) || 0) + 1);
    } finally {
      this._pollInFlight = false;
      this.schedulePoll(this.nextPollInterval(hasNewMessages));
    }
  },

  openListing() {
    const item = this.data.conversation;
    if (!item || !item.itemId) { wx.showToast({ title: '这条会话没有关联商品', icon: 'none' }); return; }
    const type = item.itemType === 'service' ? 'service' : 'product';
    wx.navigateTo({ url: '/pages/market/detail/index?id=' + encodeURIComponent(item.itemId) + '&itemType=' + type + '&source=cloud' });
  },
  retryConversation() { this.loadConversation(false); },
  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  onQuickSend(e) {
    this.sendMessage(e.currentTarget.dataset.text);
  },

  onSend() {
    this.sendMessage(this.data.inputValue);
  },

  async sendMessage(text) {
    const value = String(text || '').trim();
    if (!value || this.data.sending) return;
    this.setData({ sending: true, sendError: '' });
    try {
      const message = await messageCloud.addMessage(this.data.conversationId, value);
      const conversation = this.data.conversation || {};
      const renderedMessage = renderMessage(message, conversation, this.data.currentRole);
      const messages = this.data.messages.some(row => row.id === renderedMessage.id) ? this.data.messages : this.data.messages.concat(renderedMessage);
      this._conversationVersion = Math.max(this._conversationVersion || 0, Number(message.createdAt) || 0);
      this._emptyPolls = 0;
      this.setData({
        inputValue: this.data.inputValue.trim() === value ? '' : this.data.inputValue,
        messages,
        toView: `message-${renderedMessage.id}`,
        'conversation.lastMessage': value,
        'conversation.updatedAt': message.createdAt
      });
      this.schedulePoll(POLL_FAST_INTERVAL);
      wx.vibrateShort({ type: 'light' });
    } catch (error) {
      this.setData({ sendError: messageCloud.getErrorMessage(error) });
    } finally {
      this.setData({ sending: false });
    }
  }
});
