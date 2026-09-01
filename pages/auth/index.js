const userCloud = require('../../utils/user-cloud');
const authPolicy = require('../../utils/auth-policy');

const TAB_ROUTES = [
  '/pages/index/index',
  '/pages/market/list/list',
  '/pages/help/index/index',
  '/pages/mine/index/index'
];

Page({
  data: {
    checking: true,
    step: 'phone',
    phoneBinding: false,
    profileSaving: false,
    maskedPhone: '',
    tempAvatarUrl: '',
    tempNickName: '',
    errorText: '',
    policyChecked: false,
    policySaving: false,
    policyCheckPending: false
  },

  onLoad() {
    this.loadIdentity();
  },

  async loadIdentity() {
    if (authPolicy.INTERNAL_TEST_MODE) wx.removeStorageSync('userSessionDisabled');
    const sessionDisabled = !!wx.getStorageSync('userSessionDisabled');
    const localUser = wx.getStorageSync('userInfo') || null;
    if (!sessionDisabled && userCloud.isSignedIn(localUser)) {
      if (localUser.policiesAccepted === true) {
        this.goNext();
        return;
      }
      // 老内测账号可能没有协议字段：先显示一次协议确认，避免登录初始化被卡死。
      this.showPolicyConsent(localUser);
      return;
    }
    this.setData({ checking: true, errorText: '' });
    try {
      const profile = await userCloud.getProfile();
      this._cloudProfile = profile || null;
      const storedProfile = profile ? { ...profile, cloudSynced: true } : null;
      if (!sessionDisabled && userCloud.isSignedIn(storedProfile)) {
        getApp().acceptCloudProfile(profile);
        if (profile.policiesAccepted === true) this.goNext();
        else this.showPolicyConsent(profile);
        return;
      }
      const phoneConfirmed = !sessionDisabled && !!(profile && profile.phoneBound);
      this.setData({
        checking: false,
        step: phoneConfirmed ? 'profile' : 'phone',
        maskedPhone: phoneConfirmed ? profile.maskedPhone || '微信手机号已验证' : '',
        tempAvatarUrl: profile && profile.avatarUrl || '',
        tempNickName: profile && profile.nickName || ''
      });
    } catch (error) {
      this.setData({
        checking: false,
        step: authPolicy.INTERNAL_TEST_MODE ? 'test-error' : 'phone',
        errorText: userCloud.getErrorMessage(error)
      });
    }
  },

  onRetryInternalTest() {
    this.setData({ checking: true, errorText: '' });
    this.loadIdentity();
  },

  showPolicyConsent(profile) {
    this._cloudProfile = profile || this._cloudProfile;
    this.setData({ checking: false, step: 'consent', policyChecked: false, errorText: '' });
  },

  async onGetPhoneNumber(e) {
    if (this.data.phoneBinding) return;
    const detail = e && e.detail || {};
    const code = detail.code;
    if (!code) {
      const errMsg = String(detail.errMsg || '').toLowerCase();
      let errorText = '微信未返回手机号授权结果，请重试';
      if (errMsg.includes('deny') || errMsg.includes('cancel')) {
        errorText = '你已取消手机号授权，同意授权后才能进入小程序';
      } else if (errMsg.includes('permission') || errMsg.includes('unauthorized') || errMsg.includes('48001')) {
        errorText = '当前小程序账号尚未开通微信手机号能力，需先完成账号认证';
      } else {
        let platform = '';
        try {
          const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
          platform = deviceInfo.platform || '';
        } catch (error) { /* 无法读取时使用通用提示 */ }
        if (platform === 'devtools') {
          errorText = '开发者工具没有返回手机号，请用手机扫码预览测试';
        }
      }
      this.setData({ errorText });
      return;
    }
    this.setData({ phoneBinding: true, errorText: '' });
    try {
      const profile = await userCloud.bindPhone(code);
      if (!profile || !profile.phoneBound) throw new Error('手机号绑定失败，请重试');
      this._cloudProfile = profile;
      const stored = getApp().acceptCloudProfile(profile);
      wx.removeStorageSync('userSessionDisabled');
      if (userCloud.isSignedIn(stored)) {
        if (profile.policiesAccepted === true) this.goNext();
        else this.showPolicyConsent(profile);
        return;
      }
      this.setData({
        step: 'profile',
        maskedPhone: profile.maskedPhone || '微信手机号已验证',
        tempAvatarUrl: profile.avatarUrl || this.data.tempAvatarUrl,
        tempNickName: profile.nickName || this.data.tempNickName
      });
    } catch (error) {
      this.setData({ errorText: userCloud.getErrorMessage(error) });
    } finally {
      this.setData({ phoneBinding: false });
    }
  },

  onChooseAvatar(e) {
    this.setData({ tempAvatarUrl: e.detail.avatarUrl || '' });
  },

  onNicknameInput(e) {
    this.setData({ tempNickName: e.detail.value || '' });
  },

  onNicknameBlur(e) {
    this.setData({ tempNickName: e.detail.value || '' });
  },

  async onConfirmProfile() {
    if (this.data.profileSaving) return;
    const avatarUrl = this.data.tempAvatarUrl;
    const nickName = String(this.data.tempNickName || '').trim();
    if (!avatarUrl) {
      this.setData({ errorText: '请手动确认一次微信头像' });
      return;
    }
    if (!nickName) {
      this.setData({ errorText: '请手动确认一次微信昵称' });
      return;
    }
    this.setData({ profileSaving: true, errorText: '' });
    try {
      const profile = await userCloud.saveProfile({ avatarUrl, nickName });
      const stored = getApp().acceptCloudProfile(profile);
      if (!userCloud.isSignedIn(stored)) throw new Error('登录资料不完整，请重试');
      wx.removeStorageSync('userSessionDisabled');
      wx.removeStorageSync('mineStatsCacheV1');
      if (profile.policiesAccepted === true) this.goNext();
      else this.showPolicyConsent(profile);
    } catch (error) {
      this.setData({ errorText: userCloud.getErrorMessage(error) });
    } finally {
      this.setData({ profileSaving: false });
    }
  },

  onTogglePolicy() {
    this.setData({ policyChecked: !this.data.policyChecked, errorText: '' });
  },

  onPolicyLink(e) {
    const type = e.currentTarget.dataset.type || 'terms';
    wx.navigateTo({ url: `/pages/policies/index?type=${encodeURIComponent(type)}` });
  },

  async onAcceptPolicies() {
    if (this.data.policySaving) return;
    if (!this.data.policyChecked) {
      this.setData({ errorText: '请先阅读并同意用户协议和隐私政策' });
      return;
    }
    this.setData({ policySaving: true, errorText: '' });
    try {
      const profile = await userCloud.acceptPolicies();
      if (!profile || profile.policiesAccepted !== true) throw new Error('协议确认未保存，请重试');
      const stored = getApp().acceptCloudProfile(profile, true);
      if (!userCloud.hasAcceptedPolicies(stored)) throw new Error('协议确认未保存，请重试');
      wx.removeStorageSync('userSessionDisabled');
      this.goNext();
    } catch (error) {
      this.setData({ errorText: userCloud.getErrorMessage(error) });
    } finally {
      this.setData({ policySaving: false });
    }
  },

  goNext() {
    const target = wx.getStorageSync('postLoginRouteV1') || '/pages/index/index';
    wx.removeStorageSync('postLoginRouteV1');
    const path = String(target).split('?')[0];
    if (TAB_ROUTES.includes(path)) {
      wx.switchTab({ url: path });
    } else {
      wx.reLaunch({ url: target });
    }
  }
});
