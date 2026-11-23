const userCloud = require('../../../utils/user-cloud');
const authPolicy = require('../../../utils/auth-policy');

const DASHBOARD_REFRESH_INTERVAL = 30 * 1000;

function formatRegisteredAt(value) {
  const timestamp = Number(value) || 0;
  if (!timestamp) return '内测用户';
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${date.getMonth() + 1}月加入`;
}

Page({
  data: {
    isLoggedIn: false,
    statsReady: false,
    avatarUrl: '',
    nickName: '',
    maskedPhone: '',
    myServicesCount: 0,
    favoritesCount: 0,
    unreadMessages: 0,
    activeItemsCount: 0,
    soldItemsCount: 0,
    registeredAtText: '内测用户',
    sellerType: 'PRIVATE',
    isAdmin: false,
    isBanned: false,
    requirePhoneBinding: authPolicy.REQUIRE_PHONE_BINDING,

    showLoginModal: false,
    tempAvatarUrl: '',
    tempNickName: '',
    tempPhoneBound: false,
    tempMaskedPhone: '',
    phoneBinding: false
  },

  onLoad() {
    this.applyLocalUser();
    this.applyCachedStats();
  },
  onShow() {
    const loggedIn = this.applyLocalUser();
    this.refreshStats();
    if (!loggedIn && !wx.getStorageSync('userSessionDisabled')) {
      getApp().syncUserProfile().then(profile => {
        if (!profile) return;
        this.applyLocalUser();
        this.refreshStats(true);
      }).catch(() => {});
    }
  },

  applyLocalUser() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userCloud.isSignedIn(userInfo)) {
      this.setData({
        isLoggedIn: true,
        avatarUrl: userInfo.avatarUrl,
        nickName: userInfo.nickName,
        registeredAtText: formatRegisteredAt(userInfo.registeredAtMs),
        sellerType: userInfo.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
        maskedPhone: userInfo.phoneBound ? (userInfo.maskedPhone || '微信手机号已验证') : '内测身份'
      });
      return true;
    } else {
      this.setData({ statsReady: false, isLoggedIn: false, avatarUrl: '', nickName: '', maskedPhone: '', registeredAtText: '内测用户', sellerType: 'PRIVATE' });
      return false;
    }
  },

  applyCachedStats() {
    const cached = wx.getStorageSync('mineStatsCacheV1');
    if (cached && cached.savedAt && Date.now() - cached.savedAt < 30 * 60 * 1000) {
      this.setData({ ...cached.value, statsReady: true });
      return true;
    }
    return false;
  },

  async refreshStats(force) {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userCloud.isSignedIn(userInfo)) {
      this.setData({ myServicesCount: 0, favoritesCount: 0, unreadMessages: 0, activeItemsCount: 0, soldItemsCount: 0, isAdmin: false, isBanned: false });
      return;
    }
    const cached = wx.getStorageSync('mineStatsCacheV1');
    if (!force && cached && cached.savedAt && Date.now() - cached.savedAt < DASHBOARD_REFRESH_INTERVAL) {
      this.setData({ ...cached.value, statsReady: true });
      return;
    }
    if (this._statsPromise) return this._statsPromise;
    this._statsPromise = userCloud.getDashboard()
      .then(dashboard => {
        if (dashboard.profile) {
          getApp().acceptCloudProfile(dashboard.profile);
          this.applyLocalUser();
        }
        const value = {
          myServicesCount: dashboard.stats.mineCount,
          favoritesCount: dashboard.stats.favoritesCount,
          unreadMessages: dashboard.stats.unread,
          activeItemsCount: dashboard.stats.activeCount,
          soldItemsCount: dashboard.stats.soldCount,
          isAdmin: dashboard.permissions.isAdmin,
          isBanned: dashboard.accountStatus === 'banned'
        };
        wx.setStorageSync('mineStatsCacheV1', { savedAt: Date.now(), value });
        this.setData({ ...value, statsReady: true });
      })
      .catch(() => {})
      .finally(() => { this._statsPromise = null; });
    return this._statsPromise;
  },

  // ---- 登录 ----
  async onLoginTap() {
    if (this.data.isLoggedIn) { this.onUserTap(); return; }
    wx.reLaunch({ url: '/pages/auth/index' });
  },
  openPolicies() { wx.navigateTo({ url: '/pages/policies/index' }); },
  onCloseModal() { this.setData({ showLoginModal: false }); },
  onUserTap() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({
      showLoginModal: true,
      tempAvatarUrl: this.data.avatarUrl,
      tempNickName: this.data.nickName,
      tempPhoneBound: userInfo.phoneBound === true,
      tempMaskedPhone: userInfo.maskedPhone || this.data.maskedPhone
    });
  },
  noop() {},
  onChooseAvatar(e) { this.setData({ tempAvatarUrl: e.detail.avatarUrl }); },
  onNicknameInput(e) { this.setData({ tempNickName: e.detail.value }); },
  onNicknameBlur(e) { this.setData({ tempNickName: e.detail.value }); },

  async onGetPhoneNumber(e) {
    if (this.data.phoneBinding) return;
    const code = e && e.detail && e.detail.code;
    if (!code) {
      wx.showToast({ title: '登录必须授权绑定手机号', icon: 'none' });
      return;
    }
    this.setData({ phoneBinding: true });
    wx.showLoading({ title: '验证手机号…', mask: true });
    try {
      const profile = await userCloud.bindPhone(code);
      if (!profile || !profile.phoneBound) throw new Error('手机号绑定失败，请重试');
      getApp().acceptCloudProfile(profile);
      this.setData({
        tempPhoneBound: true,
        tempMaskedPhone: profile.maskedPhone || '微信手机号已验证',
        tempAvatarUrl: profile.avatarUrl || this.data.tempAvatarUrl,
        tempNickName: profile.nickName || this.data.tempNickName
      });
      wx.showToast({ title: '手机号绑定成功', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '绑定失败', content: userCloud.getErrorMessage(error), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ phoneBinding: false });
    }
  },

  async onConfirmLogin() {
    const { tempAvatarUrl, tempNickName, tempPhoneBound } = this.data;
    const wasLoggedIn = this.data.isLoggedIn;
    const nickName = (tempNickName || '').trim();
    if (authPolicy.REQUIRE_PHONE_BINDING && !tempPhoneBound) { wx.showToast({ title: '请先绑定微信手机号', icon: 'none' }); return; }
    if (!tempAvatarUrl) { wx.showToast({ title: '请选择头像', icon: 'none' }); return; }
    if (!nickName) { wx.showToast({ title: '请输入昵称', icon: 'none' }); return; }
    wx.showLoading({ title: '同步用户资料…', mask: true });
    try {
      const userInfo = await userCloud.saveProfile({ avatarUrl: tempAvatarUrl, nickName });
      const storedUser = getApp().acceptCloudProfile(userInfo);
      wx.removeStorageSync('userSessionDisabled');
      this.setData({
        isLoggedIn: true,
        avatarUrl: storedUser.avatarUrl,
        nickName: storedUser.nickName,
        maskedPhone: storedUser.phoneBound ? (storedUser.maskedPhone || '微信手机号已验证') : '内测身份',
        showLoginModal: false
      });
      wx.showToast({ title: wasLoggedIn ? '资料已同步' : '登录成功', icon: 'success' });
      this.refreshStats(true);
    } catch (error) {
      wx.showModal({ title: '登录失败', content: userCloud.getErrorMessage(error), showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  // ---- 菜单跳转 ----
  onMenuTap(e) {
    if (!this.data.isLoggedIn) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    const type = e.currentTarget.dataset.type;
    if (type === 'publish') { wx.navigateTo({ url: '/pages/mine/publish-list/index' }); }
    else if (type === 'favorite') { wx.navigateTo({ url: '/pages/mine/collection-list/index' }); }
    else if (type === 'message') { wx.navigateTo({ url: '/pages/mine/messages/index' }); }
    else if (type === 'settings') { wx.navigateTo({ url: '/pages/mine/settings/index' }); }
    else if (type === 'admin' && this.data.isAdmin) { wx.navigateTo({ url: '/pages/admin/index' }); }
  }
})
