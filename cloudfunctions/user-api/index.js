const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'user_profiles';
const ADMINS = 'app_admins';
// 内测绕过手机号授权；获得微信手机号能力后改为 false 并重新部署。
const INTERNAL_TEST_MODE = true;
const INTERNAL_TEST_AVATAR = '/assets/branding/mini-program-avatar.png';
const POLICY_VERSION = 'MVP-2026-08-14';
const LEGACY_POLICY_GRACE = true;

function text(value, maxLength) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength);
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    nickName: text(profile.nickName, 30),
    avatarUrl: text(profile.avatarUrl, 500),
    phoneBound: profile.phoneBound === true,
    maskedPhone: profile.phoneBound === true ? text(profile.maskedPhone, 30) : '',
    identityConfirmed: Number(profile.identityConfirmedAtMs) > 0,
    internalTestAccess: INTERNAL_TEST_MODE && profile.internalTestAccess === true,
    accountStatus: profile.status === 'banned' ? 'banned' : 'active',
    sellerType: profile.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
    registeredAtMs: Number(profile.registeredAtMs) || Number(profile.createdAtMs) || 0,
    policiesAccepted: Number(profile.policiesAcceptedAtMs) > 0 && !!text(profile.termsAcceptedVersion, 40),
    policyConsentRequired: !(Number(profile.policiesAcceptedAtMs) > 0 && !!text(profile.termsAcceptedVersion, 40)),
    termsAcceptedVersion: text(profile.termsAcceptedVersion, 40),
    updatedAtMs: Number(profile.updatedAtMs) || 0
  };
}

function maskPhone(countryCode, phoneNumber) {
  const country = text(countryCode, 6).replace(/[^0-9]/g, '');
  const phone = text(phoneNumber, 30).replace(/[^0-9]/g, '');
  if (!phone) return '';
  const prefixLength = phone.length > 7 ? 3 : 2;
  const suffixLength = phone.length > 6 ? 4 : 2;
  const middleLength = Math.max(3, phone.length - prefixLength - suffixLength);
  const masked = `${phone.slice(0, prefixLength)}${'*'.repeat(middleLength)}${phone.slice(-suffixLength)}`;
  return country ? `+${country} ${masked}` : masked;
}

function phoneDigest(countryCode, phoneNumber) {
  return crypto.createHash('sha256')
    .update(`wechat-phone:${text(countryCode, 6)}:${text(phoneNumber, 30)}`)
    .digest('hex');
}

function validAvatar(value) {
  const avatar = text(value, 500);
  return /^cloud:\/\//i.test(avatar) || (/^https:\/\//i.test(avatar) && !/^https:\/\/tmp\//i.test(avatar));
}

async function getProfile(openid) {
  try {
    const result = await db.collection(COLLECTION).doc(openid).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (message.includes('DATABASE_COLLECTION_NOT_EXIST') || message.includes('-502005')) {
      try { await db.createCollection(COLLECTION); } catch (createError) { /* 集合可能已被并发创建 */ }
      return null;
    }
    if (message.includes('does not exist') || message.includes('DOCUMENT_NOT_FOUND') || message.includes('-502001')) return null;
    throw error;
  }
}

async function ensureInternalTestProfile(openid) {
  const currentProfile = await getProfile(openid);
  if (!INTERNAL_TEST_MODE) return currentProfile;
  if (
    currentProfile
    && currentProfile.internalTestAccess === true
    && text(currentProfile.nickName, 30)
    && (validAvatar(currentProfile.avatarUrl) || currentProfile.avatarUrl === INTERNAL_TEST_AVATAR)
  ) return currentProfile;

  const now = Date.now();
  const phoneBound = !!(currentProfile && currentProfile.phoneBound === true);
  const identityConfirmedAtMs = Number(currentProfile && currentProfile.identityConfirmedAtMs) || 0;
  const profile = {
    nickName: text(currentProfile && currentProfile.nickName, 30) || `体验用户${text(openid, 40).slice(-4)}`,
    avatarUrl: currentProfile && (validAvatar(currentProfile.avatarUrl) || currentProfile.avatarUrl === INTERNAL_TEST_AVATAR)
      ? text(currentProfile.avatarUrl, 500)
      : INTERNAL_TEST_AVATAR,
    favoriteItemIds: Array.isArray(currentProfile && currentProfile.favoriteItemIds)
      ? currentProfile.favoriteItemIds.slice(0, 100)
      : [],
    blockedUserIds: Array.isArray(currentProfile && currentProfile.blockedUserIds)
      ? currentProfile.blockedUserIds.slice(0, 100)
      : [],
    sellerType: currentProfile && currentProfile.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
    registeredAtMs: Number(currentProfile && currentProfile.registeredAtMs) || now,
    registeredAt: currentProfile && currentProfile.registeredAt || db.serverDate(),
    termsAcceptedVersion: text(currentProfile && currentProfile.termsAcceptedVersion, 40),
    policiesAcceptedAtMs: Number(currentProfile && currentProfile.policiesAcceptedAtMs) || 0,
    policiesAcceptedAt: currentProfile && currentProfile.policiesAcceptedAt || null,
    status: currentProfile && currentProfile.status === 'banned' ? 'banned' : 'active',
    phoneBound,
    internalTestAccess: true,
    identityConfirmedAtMs,
    updatedAtMs: now,
    updatedAt: db.serverDate()
  };
  if (phoneBound) {
    Object.assign(profile, {
      phoneHash: text(currentProfile.phoneHash, 100),
      phoneCountryCode: text(currentProfile.phoneCountryCode, 6),
      phoneLast4: text(currentProfile.phoneLast4, 4),
      maskedPhone: text(currentProfile.maskedPhone, 30),
      phoneVerifiedAtMs: Number(currentProfile.phoneVerifiedAtMs) || now,
      phoneVerifiedAt: currentProfile.phoneVerifiedAt || db.serverDate()
    });
  }
  if (identityConfirmedAtMs) {
    profile.identityConfirmedAt = currentProfile.identityConfirmedAt || db.serverDate();
  }
  await db.collection(COLLECTION).doc(openid).set({ data: profile });
  return profile;
}

async function isAdmin(openid) {
  try {
    const result = await db.collection(ADMINS).doc(openid).get();
    return !!(result && result.data && result.data.enabled === true);
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (message.includes('DATABASE_COLLECTION_NOT_EXIST') || message.includes('-502005')) {
      try { await db.createCollection(ADMINS); } catch (createError) { /* 集合可能已被并发创建 */ }
      return false;
    }
    if (message.includes('does not exist') || message.includes('DOCUMENT_NOT_FOUND') || message.includes('-502001')) return false;
    throw error;
  }
}

exports.main = async (event) => {
  const input = event || {};
  const action = input.action || 'get';
  const openid = cloud.getWXContext().OPENID;
  if (!openid) throw new Error('无法识别当前微信用户');

  if (action === 'get') {
    const profile = await ensureInternalTestProfile(openid);
    if (LEGACY_POLICY_GRACE && profile && !Number(profile.policiesAcceptedAtMs)) {
      return { ok: true, profile: { ...publicProfile(profile), policiesAccepted: false, policyConsentRequired: true } };
    }
    return { ok: true, profile: publicProfile(profile) };
  }

  if (action === 'bindPhone') {
    const code = text(input.code, 300);
    if (!code) throw new Error('请重新点击授权绑定手机号');
    const currentProfile = await getProfile(openid);
    if (currentProfile && currentProfile.status === 'banned') throw new Error('账号已被限制使用');
    let result;
    try {
      result = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '');
      throw new Error(message || '微信手机号验证失败，请重试');
    }
    const phoneInfo = result && (result.phoneInfo || result.phone_info || (result.result && result.result.phoneInfo));
    const phoneNumber = text(phoneInfo && (phoneInfo.purePhoneNumber || phoneInfo.pure_phone_number || phoneInfo.phoneNumber || phoneInfo.phone_number), 30)
      .replace(/[^0-9]/g, '');
    const countryCode = text(phoneInfo && (phoneInfo.countryCode || phoneInfo.country_code), 6)
      .replace(/[^0-9]/g, '');
    if (!phoneNumber) throw new Error('微信未返回可用手机号，请重新授权');
    const now = Date.now();
    const profile = {
      nickName: text(currentProfile && currentProfile.nickName, 30),
      avatarUrl: text(currentProfile && currentProfile.avatarUrl, 500),
      favoriteItemIds: Array.isArray(currentProfile && currentProfile.favoriteItemIds)
        ? currentProfile.favoriteItemIds.slice(0, 100)
        : [],
      blockedUserIds: Array.isArray(currentProfile && currentProfile.blockedUserIds)
        ? currentProfile.blockedUserIds.slice(0, 100)
        : [],
      sellerType: currentProfile && currentProfile.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
      registeredAtMs: Number(currentProfile && currentProfile.registeredAtMs) || now,
      registeredAt: currentProfile && currentProfile.registeredAt || db.serverDate(),
      termsAcceptedVersion: text(currentProfile && currentProfile.termsAcceptedVersion, 40),
      policiesAcceptedAtMs: Number(currentProfile && currentProfile.policiesAcceptedAtMs) || 0,
      policiesAcceptedAt: currentProfile && currentProfile.policiesAcceptedAt || null,
      status: 'active',
      phoneBound: true,
      internalTestAccess: INTERNAL_TEST_MODE && !!(currentProfile && currentProfile.internalTestAccess),
      phoneHash: phoneDigest(countryCode, phoneNumber),
      phoneCountryCode: countryCode,
      phoneLast4: phoneNumber.slice(-4),
      maskedPhone: maskPhone(countryCode, phoneNumber),
      phoneVerifiedAtMs: now,
      phoneVerifiedAt: db.serverDate(),
      identityConfirmedAtMs: Number(currentProfile && currentProfile.identityConfirmedAtMs) || 0,
      updatedAtMs: now,
      updatedAt: db.serverDate()
    };
    await db.collection(COLLECTION).doc(openid).set({ data: profile });
    return { ok: true, profile: publicProfile(profile) };
  }

  if (action === 'dashboard') {
    const [profile, mineResult, conversationsResult, notificationsResult, admin] = await Promise.all([
      getProfile(openid),
      db.collection('market_items').where({ ownerOpenId: openid }).limit(100).get(),
      db.collection('market_conversations').where(_.or([
        { buyerOpenId: openid },
        { sellerOpenId: openid }
      ])).limit(100).get(),
      db.collection('market_notifications').where({ recipientOpenId: openid }).limit(100).get(),
      isAdmin(openid)
    ]);
    const mineItems = mineResult.data || [];
    const conversationUnread = (conversationsResult.data || []).reduce((sum, conversation) => {
      const unread = conversation.sellerOpenId === openid
        ? conversation.unreadForSeller
        : conversation.unreadForBuyer;
      return sum + (Number(unread) || 0);
    }, 0);
    const notificationUnread = (notificationsResult.data || []).filter(notification => !notification.read).length;
    return {
      ok: true,
      profile: publicProfile(profile),
      permissions: { isAdmin: admin },
      stats: {
        mineCount: mineItems.filter(item => item.status !== 'deleted').length,
        activeCount: mineItems.filter(item => item.status === 'active' && item.publishType === 'market').length,
        soldCount: mineItems.filter(item => item.status === 'sold' && item.publishType === 'market').length,
        favoritesCount: Array.isArray(profile && profile.favoriteItemIds) ? profile.favoriteItemIds.length : 0,
        unread: conversationUnread + notificationUnread
      }
    };
  }

  if (action === 'acceptPolicies') {
    const currentProfile = await ensureInternalTestProfile(openid);
    if (!currentProfile) throw new Error('请先完成微信登录');
    if (currentProfile.status === 'banned') throw new Error('账号已被限制使用');
    const identityReady = currentProfile.phoneBound === true
      || (INTERNAL_TEST_MODE && currentProfile.internalTestAccess === true);
    if (!identityReady) throw new Error('请先完成微信身份确认');
    const now = Date.now();
    await db.collection(COLLECTION).doc(openid).update({
      data: {
        termsAcceptedVersion: POLICY_VERSION,
        policiesAcceptedAtMs: now,
        policiesAcceptedAt: db.serverDate(),
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    });
    return {
      ok: true,
      profile: publicProfile({
        ...currentProfile,
        termsAcceptedVersion: POLICY_VERSION,
        policiesAcceptedAtMs: now,
        updatedAtMs: now
      })
    };
  }

  if (action === 'save') {
    const nickName = text(input.profile && input.profile.nickName, 30);
    const avatarUrl = text(input.profile && input.profile.avatarUrl, 500);
    if (!nickName) throw new Error('请输入昵称');
    const avatarReady = validAvatar(avatarUrl)
      || (INTERNAL_TEST_MODE && avatarUrl === INTERNAL_TEST_AVATAR);
    if (!avatarReady) throw new Error('头像尚未成功上传，请重新选择');
    const updatedAtMs = Date.now();
    const currentProfile = await getProfile(openid);
    if (currentProfile && currentProfile.status === 'banned') throw new Error('账号已被限制使用');
    if (!currentProfile || (currentProfile.phoneBound !== true && !(INTERNAL_TEST_MODE && currentProfile.internalTestAccess === true))) {
      throw new Error('请先授权绑定微信手机号');
    }
    const favoriteItemIds = Array.isArray(currentProfile && currentProfile.favoriteItemIds)
      ? currentProfile.favoriteItemIds.slice(0, 100)
      : [];
    const profile = {
      nickName,
      avatarUrl,
      favoriteItemIds,
      blockedUserIds: Array.isArray(currentProfile && currentProfile.blockedUserIds)
        ? currentProfile.blockedUserIds.slice(0, 100)
        : [],
      sellerType: currentProfile.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
      registeredAtMs: Number(currentProfile.registeredAtMs) || updatedAtMs,
      registeredAt: currentProfile.registeredAt || db.serverDate(),
      termsAcceptedVersion: text(currentProfile.termsAcceptedVersion, 40),
      policiesAcceptedAtMs: Number(currentProfile.policiesAcceptedAtMs) || 0,
      policiesAcceptedAt: currentProfile.policiesAcceptedAt || null,
      status: 'active',
      phoneBound: currentProfile.phoneBound === true,
      internalTestAccess: INTERNAL_TEST_MODE && currentProfile.internalTestAccess === true,
      identityConfirmedAtMs: updatedAtMs,
      identityConfirmedAt: db.serverDate(),
      updatedAtMs,
      updatedAt: db.serverDate()
    };
    if (currentProfile.phoneBound === true) {
      Object.assign(profile, {
        phoneHash: text(currentProfile.phoneHash, 100),
        phoneCountryCode: text(currentProfile.phoneCountryCode, 6),
        phoneLast4: text(currentProfile.phoneLast4, 4),
        maskedPhone: text(currentProfile.maskedPhone, 30),
        phoneVerifiedAtMs: Number(currentProfile.phoneVerifiedAtMs) || updatedAtMs,
        phoneVerifiedAt: currentProfile.phoneVerifiedAt || db.serverDate()
      });
    }
    await db.collection(COLLECTION).doc(openid).set({ data: profile });
    await Promise.allSettled([
      db.collection('market_items').where({ ownerOpenId: openid }).update({
        data: { publisherNick: nickName, publisherAvatar: avatarUrl, updatedAtMs }
      }),
      db.collection('market_conversations').where({ buyerOpenId: openid }).update({
        data: { buyerName: nickName, buyerAvatar: avatarUrl }
      }),
      db.collection('market_conversations').where({ sellerOpenId: openid }).update({
        data: { sellerName: nickName, sellerAvatar: avatarUrl }
      }),
      db.collection('market_notifications').where({ actorOpenId: openid }).update({
        data: { actorNick: nickName, actorAvatar: avatarUrl }
      })
    ]);
    return { ok: true, profile: publicProfile(profile) };
  }

  throw new Error('不支持的操作');
};
