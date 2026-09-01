const i18n = require('./utils/i18n.js');
const userCloud = require('./utils/user-cloud.js');
const marketCloud = require('./utils/market-cloud.js');

const CLOUD_ENV_ID = 'cloud1-d9glh048lb56b8a00';
const PROFILE_SYNC_KEY = 'userProfileSyncedAtV2';
const PROFILE_SYNC_INTERVAL = 3 * 60 * 60 * 1000;

App({
  onLaunch() {
    // 初始化语言
    const lang = i18n.getLang();
    if (wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
      this.globalData.cloudReady = true;
      setTimeout(() => this.syncUserProfile(), 2000);
    }
    this.clearLegacyMarketData();
  },
  onShow() {
    setTimeout(() => this.enforceIdentityGate(), 80);
    setTimeout(() => this.enforceIdentityGate(), 600);
  },
  globalData: {
    userInfo: null,
    lang: 'zh-CN',
    cloudReady: false,
    marketNeedsRefresh: false,
    serviceNeedsRefresh: false
  },
  i18n: i18n,

  enforceIdentityGate() {
    const localUser = wx.getStorageSync('userInfo') || null;
    const sessionDisabled = !!wx.getStorageSync('userSessionDisabled');
    if (!sessionDisabled && userCloud.isSignedIn(localUser) && userCloud.hasAcceptedPolicies(localUser)) return true;
    const pages = getCurrentPages();
    const current = pages && pages.length ? pages[pages.length - 1] : null;
    const route = current && current.route || '';
    if (!route || route === 'pages/auth/index') return false;
    const options = current.options || {};
    const query = Object.keys(options).map(key => (
      `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`
    )).join('&');
    wx.setStorageSync('postLoginRouteV1', `/${route}${query ? `?${query}` : ''}`);
    wx.reLaunch({ url: '/pages/auth/index' });
    return false;
  },

  async syncUserProfile() {
    if (wx.getStorageSync('userSessionDisabled')) return null;
    const cachedUser = wx.getStorageSync('userInfo') || null;
    const lastSyncedAt = Number(this._profileSyncedAt || wx.getStorageSync(PROFILE_SYNC_KEY)) || 0;
    if (userCloud.isSignedIn(cachedUser) && userCloud.hasAcceptedPolicies(cachedUser) && lastSyncedAt && Date.now() - lastSyncedAt < PROFILE_SYNC_INTERVAL) {
      this.globalData.userInfo = cachedUser;
      this.scheduleMaintenance();
      return cachedUser;
    }
    if (!this._profileSyncPromise) {
      this._profileSyncPromise = (async () => {
        try {
          let profile = await userCloud.getProfile();
          const localUser = wx.getStorageSync('userInfo') || {};
          if (profile && profile.identityConfirmed && userCloud.isTemporaryPath(profile.avatarUrl) && localUser.nickName && localUser.avatarUrl) {
            profile = await userCloud.saveProfile({
              nickName: profile.nickName || localUser.nickName,
              avatarUrl: localUser.avatarUrl
            });
          }
          if (!profile && localUser.identityConfirmed && localUser.phoneBound && localUser.nickName && localUser.avatarUrl) {
            profile = await userCloud.saveProfile(localUser);
          }
          if (profile) {
            this.acceptCloudProfile(profile);
          }
          return profile;
        } catch (error) {
          return null;
        }
      })();
    }
    try {
      return await this._profileSyncPromise;
    } finally {
      this._profileSyncPromise = null;
    }
  },

  acceptCloudProfile(profile, force) {
    if (!profile) return null;
    const current = wx.getStorageSync('userInfo') || null;
    const currentUpdatedAt = Number(current && current.updatedAtMs) || 0;
    const incomingUpdatedAt = Number(profile.updatedAtMs) || 0;
    if (!force && current && currentUpdatedAt > incomingUpdatedAt) {
      this.globalData.userInfo = current;
      return current;
    }
    const stored = userCloud.storeProfile(profile);
    this.globalData.userInfo = stored;
    this._profileSyncedAt = Date.now();
    wx.setStorageSync(PROFILE_SYNC_KEY, this._profileSyncedAt);
    if (userCloud.isSignedIn(stored) && userCloud.hasAcceptedPolicies(stored)) this.scheduleMaintenance();
    return stored;
  },

  scheduleMaintenance() {
    if (this._maintenanceScheduled) return;
    const pending = [
      'legacyPublishedCloudMigrationV1',
      'legacyFavoriteCloudMigrationV1',
      'temporaryCloudMediaMigrationV1',
      'cloudDuplicateCleanupV1'
    ].some(key => !wx.getStorageSync(key));
    if (!pending) return;
    this._maintenanceScheduled = true;
    setTimeout(async () => {
      try {
        await this.migrateLegacyPublishedItems();
        await this.migrateLegacyFavorites();
        await this.repairTemporaryCloudMedia();
        await this.cleanupDuplicateCloudItems();
      } finally {
        this._maintenanceScheduled = false;
      }
    }, 4000);
  },

  async repairTemporaryCloudMedia() {
    const migrationKey = 'temporaryCloudMediaMigrationV1';
    if (wx.getStorageSync(migrationKey)) return { done: true };
    try {
      const result = await marketCloud.repairMineTemporaryMedia();
      if (!result.failed) wx.setStorageSync(migrationKey, true);
      if (result.repaired) {
        this.globalData.marketNeedsRefresh = true;
        this.globalData.serviceNeedsRefresh = true;
      }
      return { done: !result.failed };
    } catch (error) { return { done: false }; }
  },

  async migrateLegacyPublishedItems() {
    const migrationKey = 'legacyPublishedCloudMigrationV1';
    if (wx.getStorageSync(migrationKey)) return { done: true };
    let items = wx.getStorageSync('publishedItems') || [];
    if (!Array.isArray(items) || !items.length) {
      wx.setStorageSync(migrationKey, true);
      return { done: true };
    }
    for (const item of items.slice()) {
      try {
        await marketCloud.saveItem(item);
        items = items.filter(entry => String(entry.id) !== String(item.id));
        wx.setStorageSync('publishedItems', items);
        this.globalData.marketNeedsRefresh = true;
        this.globalData.serviceNeedsRefresh = true;
      } catch (error) { /* 保留本机副本，下次启动继续迁移 */ }
    }
    if (!items.length) wx.setStorageSync(migrationKey, true);
    return { done: !items.length };
  },

  async migrateLegacyFavorites() {
    const migrationKey = 'legacyFavoriteCloudMigrationV1';
    if (wx.getStorageSync(migrationKey)) return { done: true };
    let items = wx.getStorageSync('favorites') || [];
    if (!Array.isArray(items) || !items.length) {
      wx.setStorageSync(migrationKey, true);
      return { done: true };
    }
    for (const item of items.slice()) {
      const id = item && (item._id || item.id);
      if (!id) continue;
      try {
        await marketCloud.toggleFavorite(String(id), true);
        items = items.filter(entry => String(entry && (entry._id || entry.id)) !== String(id));
        wx.setStorageSync('favorites', items);
      } catch (error) { /* 保留本机收藏，下次启动继续迁移 */ }
    }
    if (!items.length) wx.setStorageSync(migrationKey, true);
    return { done: !items.length };
  },

  async cleanupDuplicateCloudItems() {
    const migrationKey = 'cloudDuplicateCleanupV1';
    if (wx.getStorageSync(migrationKey)) return { done: true };
    try {
      const removed = await marketCloud.dedupeMine();
      wx.setStorageSync(migrationKey, true);
      if (removed) {
        this.globalData.marketNeedsRefresh = true;
        this.globalData.serviceNeedsRefresh = true;
      }
      return { done: true };
    } catch (error) { return { done: false }; }
  },

  // 全局轻触感反馈（供各处调用）
  tapVibrate() {
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 忽略不支持的情况 */ }
  },

  clearLegacyMarketData() {
    const migrationKey = 'marketCloudOnlyMigrationV2';
    if (wx.getStorageSync(migrationKey)) return;
    wx.removeStorageSync('marketItems');
    wx.removeStorageSync('chatConversations');
    wx.removeStorageSync('messageNotifications');
    wx.setStorageSync(migrationKey, true);
  }
})
