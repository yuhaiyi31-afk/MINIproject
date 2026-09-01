const FUNCTION_NAME = 'user-api';
const authPolicy = require('./auth-policy');

function ensureCloud() {
  if (!wx.cloud || !wx.cloud.callFunction || !wx.cloud.uploadFile) {
    throw new Error('当前小程序尚未开通用户云服务');
  }
}

async function call(action, data) {
  ensureCloud();
  const response = await wx.cloud.callFunction({
    name: FUNCTION_NAME,
    data: { action, ...(data || {}) }
  });
  const result = response && response.result;
  if (!result || result.ok !== true) throw new Error((result && result.message) || '用户云服务返回异常');
  return result;
}

function isTemporaryPath(path) {
  return /^https?:\/\/tmp\//i.test(String(path || '')) || /^wxfile:\/\//i.test(String(path || ''));
}

function isRemotePath(path) {
  const value = String(path || '');
  return !isTemporaryPath(value) && (/^cloud:\/\//i.test(value) || /^https?:\/\//i.test(value) || /^\/assets\//i.test(value));
}

function getExtension(path) {
  const cleanPath = String(path || '').split('?')[0];
  const match = cleanPath.match(/\.[a-zA-Z0-9]{2,5}$/);
  return match ? match[0].toLowerCase() : '.jpg';
}

async function uploadAvatar(path) {
  if (!path || isRemotePath(path)) return path || '';
  ensureCloud();
  let uploadPath = path;
  if (wx.compressImage) {
    try {
      const options = { src: path, quality: 80 };
      if (wx.getImageInfo) {
        const info = await wx.getImageInfo({ src: path });
        const width = Number(info && info.width) || 0;
        const height = Number(info && info.height) || 0;
        const longestSide = Math.max(width, height);
        if (longestSide > 512) {
          const scale = 512 / longestSide;
          options.compressedWidth = Math.max(1, Math.round(width * scale));
          options.compressedHeight = Math.max(1, Math.round(height * scale));
        }
      }
      const compressed = await wx.compressImage(options);
      if (compressed && compressed.tempFilePath) uploadPath = compressed.tempFilePath;
    } catch (error) { /* 压缩失败时上传原头像，登录流程不受影响 */ }
  }
  const cloudPath = `users/avatars/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${getExtension(uploadPath)}`;
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: uploadPath });
  if (!result || !result.fileID) throw new Error('头像上传失败');
  return result.fileID;
}

async function getProfile() {
  const result = await call('get');
  return result.profile || null;
}

async function bindPhone(code) {
  const result = await call('bindPhone', { code });
  return result.profile || null;
}

async function acceptPolicies() {
  const result = await call('acceptPolicies');
  return result.profile || null;
}

async function getDashboard() {
  const result = await call('dashboard');
  return {
    profile: result.profile || null,
    stats: {
      mineCount: Number(result.stats && result.stats.mineCount) || 0,
      activeCount: Number(result.stats && result.stats.activeCount) || 0,
      soldCount: Number(result.stats && result.stats.soldCount) || 0,
      favoritesCount: Number(result.stats && result.stats.favoritesCount) || 0,
      unread: Number(result.stats && result.stats.unread) || 0
    },
    permissions: { isAdmin: !!(result.permissions && result.permissions.isAdmin) },
    accountStatus: result.profile && result.profile.accountStatus === 'banned' ? 'banned' : 'active'
  };
}

async function saveProfile(profile) {
  const avatarUrl = await uploadAvatar(profile && profile.avatarUrl);
  const result = await call('save', {
    profile: {
      nickName: profile && profile.nickName,
      avatarUrl
    }
  });
  return result.profile;
}

function storeProfile(profile) {
  const userInfo = profile ? { ...profile, cloudSynced: true } : null;
  if (userInfo) wx.setStorageSync('userInfo', userInfo);
  return userInfo;
}

function isSignedIn(profile) {
  const value = profile || {};
  const phoneIdentityReady = value.phoneBound === true && value.identityConfirmed === true;
  const internalTestIdentityReady = authPolicy.INTERNAL_TEST_MODE && value.internalTestAccess === true;
  return !!(
    value.cloudSynced
    && (phoneIdentityReady || internalTestIdentityReady)
    && value.avatarUrl
    && value.nickName
  );
}

function hasAcceptedPolicies(profile) {
  return !!(profile && profile.policiesAccepted === true);
}

function getErrorMessage(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  const lowerMessage = message.toLowerCase();
  const functionMissing = message.includes('FunctionName parameter could not be found')
    || lowerMessage.includes('function_not_found')
    || lowerMessage.includes('function not found')
    || lowerMessage.includes('function does not exist');
  if (functionMissing) return '云函数 user-api 尚未部署';
  if (message.includes('collection') || message.includes('-502005')) return '用户资料集合尚未创建';
  if (message.includes('48001') || message.includes('api unauthorized') || message.includes('not authorized')) {
    return '当前小程序账号尚未获得微信手机号能力，请先在公众平台完成相关认证';
  }
  if (message.includes('40029') || message.includes('invalid code')) return '本次微信授权已失效，请重新点击绑定';
  if (message.includes('45011') || message.includes('frequency')) return '操作太频繁，请稍后再试';
  if (message.includes('getPhoneNumber') || message.includes('phonenumber')) return '微信手机号验证暂时不可用，请稍后重试';
  return message || '用户云服务暂时不可用';
}

module.exports = {
  isTemporaryPath,
  isSignedIn,
  hasAcceptedPolicies,
  getProfile,
  bindPhone,
  acceptPolicies,
  getDashboard,
  saveProfile,
  storeProfile,
  getErrorMessage
};
