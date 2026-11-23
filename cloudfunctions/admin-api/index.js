const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const contentPolicy = require('./content-policy');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MARKET_ITEMS = 'market_items';
const USER_PROFILES = 'user_profiles';
// 内测绕过手机号授权；上线强制绑定前改为 false 并重新部署。
const INTERNAL_TEST_MODE = true;
const REPORTS = 'market_reports';
const ADMINS = 'app_admins';
const AUDIT_LOGS = 'admin_audit_logs';

function text(value, maxLength) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength);
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function token(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 40)}`;
}

function isMissing(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  return message.includes('does not exist')
    || message.includes('DOCUMENT_NOT_FOUND')
    || message.includes('DATABASE_COLLECTION_NOT_EXIST')
    || message.includes('-502001')
    || message.includes('-502005');
}

function isMissingCollection(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  return message.includes('DATABASE_COLLECTION_NOT_EXIST') || message.includes('-502005');
}

async function createCollectionIfMissing(name) {
  try {
    await db.createCollection(name);
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (!message.includes('already exist') && !message.includes('already exists') && !message.includes('集合已存在')) throw error;
  }
}

async function getDocument(collectionName, id) {
  try {
    const result = await db.collection(collectionName).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function getProfile(openid, requireActive) {
  const profile = await getDocument(USER_PROFILES, openid);
  const phoneIdentityReady = profile
    && profile.phoneBound === true
    && !!number(profile.identityConfirmedAtMs)
    && !!text(profile.nickName, 30);
  const internalTestIdentityReady = profile
    && INTERNAL_TEST_MODE
    && profile.internalTestAccess === true
    && !!text(profile.nickName, 30);
  const policyReady = profile && (
    (!!text(profile.termsAcceptedVersion, 40) && !!number(profile.policiesAcceptedAtMs))
    || (INTERNAL_TEST_MODE && profile.internalTestAccess === true)
  );
  if ((!phoneIdentityReady && !internalTestIdentityReady) || !policyReady) {
    throw new Error('请先完成微信身份确认并同意用户协议和隐私政策');
  }
  if (requireActive && profile.status === 'banned') throw new Error('账号已被限制使用');
  return profile;
}

async function getAdmin(openid) {
  const admin = await getDocument(ADMINS, openid);
  return admin && admin.enabled === true ? admin : null;
}

async function assertAdmin(openid) {
  await getProfile(openid, true);
  const admin = await getAdmin(openid);
  if (!admin) throw new Error('无管理员权限');
  return admin;
}

async function resolveFileURLs(values) {
  const source = (Array.isArray(values) ? values : [values]).map(value => text(value, 500));
  const fileIds = Array.from(new Set(source.filter(value => /^cloud:\/\//i.test(value))));
  if (!fileIds.length) return source;
  try {
    const chunks = [];
    for (let index = 0; index < fileIds.length; index += 50) chunks.push(fileIds.slice(index, index + 50));
    const results = await Promise.all(chunks.map(fileList => cloud.getTempFileURL({ fileList })));
    const urls = new Map(results.flatMap(result => result.fileList || []).map(file => [
      file.fileID,
      file.status === 0 && file.tempFileURL ? file.tempFileURL : file.fileID
    ]));
    return source.map(value => urls.get(value) || value);
  } catch (error) {
    return source;
  }
}

function reportView(report) {
  return {
    id: report._id,
    targetType: report.targetType === 'user' ? 'user' : 'item',
    itemId: text(report.itemId, 100),
    itemTitle: text(report.itemTitle, 80),
    itemType: report.itemType === 'service' ? 'service' : 'product',
    itemThumb: text(report.itemThumb, 500),
    reason: text(report.reason, 40),
    detail: text(report.detail, 300),
    status: ['pending', 'actioned', 'dismissed'].includes(report.status) ? report.status : 'pending',
    reporterName: text(report.reporterName, 30) || '用户',
    reporterAvatar: text(report.reporterAvatar, 500),
    ownerName: text(report.ownerName, 30) || '发布者',
    ownerAvatar: text(report.ownerAvatar, 500),
    createdAtMs: number(report.createdAtMs),
    updatedAtMs: number(report.updatedAtMs),
    resolution: text(report.resolution, 30),
    resolutionNote: text(report.resolutionNote, 200),
    resolvedAtMs: number(report.resolvedAtMs)
  };
}

function itemView(item) {
  const images = Array.isArray(item.images) ? item.images : [];
  return {
    id: item._id,
    title: text(item.title, 80),
    price: Math.max(0, number(item.price)),
    status: ['active', 'unlisted', 'sold', 'suspended', 'deleted', 'deleting'].includes(item.status) ? item.status : 'unlisted',
    itemType: item.publishType === 'service' ? 'service' : 'product',
    thumb: text(item.thumbnail, 500) || text(images[0], 500),
    ownerName: text(item.publisherNick, 30) || '发布者',
    ownerAvatar: text(item.publisherAvatar, 500),
    createdAtMs: number(item.createdAtMs),
    updatedAtMs: number(item.updatedAtMs)
  };
}

function userView(profile) {
  return {
    id: profile._id,
    nickName: text(profile.nickName, 30) || '用户',
    avatarUrl: text(profile.avatarUrl, 500),
    status: profile.status === 'banned' ? 'banned' : 'active',
    sellerType: profile.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
    registeredAtMs: number(profile.registeredAtMs),
    banReason: text(profile.banReason, 200),
    updatedAtMs: number(profile.updatedAtMs),
    bannedAtMs: number(profile.bannedAtMs)
  };
}

async function resolveReportsMedia(reports) {
  const media = [];
  reports.forEach(report => media.push(report.itemThumb, report.reporterAvatar, report.ownerAvatar));
  const resolved = await resolveFileURLs(media);
  return reports.map((report, index) => ({
    ...report,
    itemThumb: resolved[index * 3] || '',
    reporterAvatar: resolved[index * 3 + 1] || '',
    ownerAvatar: resolved[index * 3 + 2] || ''
  }));
}

async function resolveItemsMedia(items) {
  const media = [];
  items.forEach(item => media.push(item.thumb, item.ownerAvatar));
  const resolved = await resolveFileURLs(media);
  return items.map((item, index) => ({
    ...item,
    thumb: resolved[index * 2] || '',
    ownerAvatar: resolved[index * 2 + 1] || ''
  }));
}

async function resolveUsersMedia(users) {
  const resolved = await resolveFileURLs(users.map(user => user.avatarUrl));
  return users.map((user, index) => ({ ...user, avatarUrl: resolved[index] || '' }));
}

async function submitReport(input, openid) {
  const reporter = await getProfile(openid, true);
  const itemId = text(input.itemId, 100);
  const reason = text(input.reason, 40);
  const detail = text(input.detail, 300);
  if (!itemId) throw new Error('缺少举报内容');
  if (!reason) throw new Error('请选择举报原因');
  const item = await getDocument(MARKET_ITEMS, itemId);
  if (!item || item.status !== 'active') throw new Error('该内容不存在或已下架');
  if (item.ownerOpenId === openid) throw new Error('不能举报自己发布的内容');
  const reportId = token('report', `${openid}:${itemId}`);
  const now = Date.now();
  const images = Array.isArray(item.images) ? item.images : [];
  const report = {
    targetType: 'item',
    itemId,
    itemOwnerOpenId: item.ownerOpenId,
    itemTitle: text(item.title, 80),
    itemType: item.publishType === 'service' ? 'service' : 'product',
    itemThumb: text(item.thumbnail, 500) || text(images[0], 500),
    reason,
    detail,
    reporterOpenId: openid,
    reporterName: text(reporter.nickName, 30),
    reporterAvatar: text(reporter.avatarUrl, 500),
    ownerName: text(item.publisherNick, 30),
    ownerAvatar: text(item.publisherAvatar, 500),
    status: 'pending',
    resolution: '',
    resolutionNote: '',
    resolvedAtMs: 0,
    resolvedBy: '',
    createdAtMs: now,
    updatedAtMs: now,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
  try {
    const existing = await db.collection(REPORTS).doc(reportId).get();
    if (existing && existing.data) return reportId;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  try {
    await db.collection(REPORTS).doc(reportId).set({ data: report });
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    await createCollectionIfMissing(REPORTS);
    await db.collection(REPORTS).doc(reportId).set({ data: report });
  }
  return reportId;
}

async function submitUserReport(input, openid) {
  const reporter = await getProfile(openid, true);
  const itemId = text(input.itemId, 100);
  const reason = text(input.reason, 40);
  const detail = text(input.detail, 300);
  if (!itemId) throw new Error('缺少关联商品');
  if (!reason) throw new Error('请选择举报原因');
  const item = await getDocument(MARKET_ITEMS, itemId);
  if (!item || !item.ownerOpenId) throw new Error('无法识别该用户');
  if (item.ownerOpenId === openid) throw new Error('不能举报自己');
  const now = Date.now();
  const reportId = token('user_report', `${openid}:${item.ownerOpenId}`);
  const images = Array.isArray(item.images) ? item.images : [];
  const report = {
    targetType: 'user',
    targetUserOpenId: item.ownerOpenId,
    itemId,
    itemOwnerOpenId: item.ownerOpenId,
    itemTitle: text(item.title, 80),
    itemType: item.publishType === 'service' ? 'service' : 'product',
    itemThumb: text(item.thumbnail, 500) || text(images[0], 500),
    reason,
    detail,
    reporterOpenId: openid,
    reporterName: text(reporter.nickName, 30),
    reporterAvatar: text(reporter.avatarUrl, 500),
    ownerName: text(item.publisherNick, 30),
    ownerAvatar: text(item.publisherAvatar, 500),
    status: 'pending',
    resolution: '',
    resolutionNote: '',
    resolvedAtMs: 0,
    resolvedBy: '',
    createdAtMs: now,
    updatedAtMs: now,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
  const existing = await getDocument(REPORTS, reportId);
  if (existing) return reportId;
  try {
    await db.collection(REPORTS).doc(reportId).set({ data: report });
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    await createCollectionIfMissing(REPORTS);
    await db.collection(REPORTS).doc(reportId).set({ data: report });
  }
  return reportId;
}

async function getBlockRelationship(input, openid) {
  const profile = await getProfile(openid, true);
  const item = await getDocument(MARKET_ITEMS, text(input.itemId, 100));
  if (!item || !item.ownerOpenId || item.ownerOpenId === openid) return { blocked: false, canBlock: false };
  const blockedUserIds = Array.isArray(profile.blockedUserIds) ? profile.blockedUserIds : [];
  return { blocked: blockedUserIds.includes(item.ownerOpenId), canBlock: true };
}

async function toggleBlockUser(input, openid) {
  const profile = await getProfile(openid, true);
  const item = await getDocument(MARKET_ITEMS, text(input.itemId, 100));
  if (!item || !item.ownerOpenId) throw new Error('无法识别该用户');
  if (item.ownerOpenId === openid) throw new Error('不能拉黑自己');
  const shouldBlock = input.blocked !== false;
  const ids = (Array.isArray(profile.blockedUserIds) ? profile.blockedUserIds : [])
    .map(value => text(value, 100))
    .filter(value => value && value !== item.ownerOpenId);
  if (shouldBlock) ids.unshift(item.ownerOpenId);
  await db.collection(USER_PROFILES).doc(openid).update({
    data: { blockedUserIds: ids.slice(0, 100), updatedAtMs: Date.now(), updatedAt: db.serverDate() }
  });
  return { blocked: shouldBlock };
}

async function listBlockedUsers(openid) {
  const profile = await getProfile(openid, true);
  const ids = (Array.isArray(profile.blockedUserIds) ? profile.blockedUserIds : [])
    .map(value => text(value, 100))
    .filter(Boolean)
    .slice(0, 100);
  const profiles = await Promise.all(ids.map(id => getDocument(USER_PROFILES, id)));
  const users = ids.map((id, index) => ({
    id: token('blocked_user', id),
    nickName: text(profiles[index] && profiles[index].nickName, 30) || '用户',
    avatarUrl: text(profiles[index] && profiles[index].avatarUrl, 500)
  }));
  const avatars = await resolveFileURLs(users.map(user => user.avatarUrl));
  return users.map((user, index) => ({ ...user, avatarUrl: avatars[index] || '' }));
}

async function unblockUser(input, openid) {
  const profile = await getProfile(openid, true);
  const publicId = text(input.userId, 100);
  const ids = (Array.isArray(profile.blockedUserIds) ? profile.blockedUserIds : [])
    .map(value => text(value, 100))
    .filter(Boolean);
  const targetId = ids.find(id => token('blocked_user', id) === publicId);
  if (!targetId) return false;
  await db.collection(USER_PROFILES).doc(openid).update({
    data: { blockedUserIds: ids.filter(id => id !== targetId), updatedAtMs: Date.now(), updatedAt: db.serverDate() }
  });
  return true;
}

async function logAdminOperation(adminOpenId, action, targetType, targetId, detail) {
  const now = Date.now();
  const id = token('audit', `${adminOpenId}:${action}:${targetType}:${targetId}:${now}:${Math.random()}`);
  const data = {
    adminOpenId,
    action: text(action, 40),
    targetType: text(targetType, 30),
    targetId: text(targetId, 100),
    detail: text(detail, 300),
    createdAtMs: now,
    createdAt: db.serverDate()
  };
  try {
    await db.collection(AUDIT_LOGS).doc(id).set({ data });
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    await createCollectionIfMissing(AUDIT_LOGS);
    await db.collection(AUDIT_LOGS).doc(id).set({ data });
  }
}

async function listReports() {
  try {
    const result = await db.collection(REPORTS).orderBy('updatedAtMs', 'desc').limit(50).get();
    return resolveReportsMedia((result.data || []).map(reportView));
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    await createCollectionIfMissing(REPORTS);
    return [];
  }
}

async function listItems() {
  const result = await db.collection(MARKET_ITEMS).orderBy('createdAtMs', 'desc').limit(50).get();
  return resolveItemsMedia((result.data || []).map(itemView));
}

async function listUsers() {
  const result = await db.collection(USER_PROFILES).orderBy('updatedAtMs', 'desc').limit(50).get();
  return resolveUsersMedia((result.data || []).map(userView));
}

async function unlistOwnedItems(userId) {
  const result = await db.collection(MARKET_ITEMS).where({ ownerOpenId: userId }).limit(100).get();
  const activeIds = (result.data || [])
    .filter(item => item.status === 'active')
    .map(item => item._id);
  if (!activeIds.length) return 0;
  const now = Date.now();
  await Promise.all(activeIds.map(itemId => db.collection(MARKET_ITEMS).doc(itemId).update({
    data: {
      status: 'suspended',
      moderationReason: 'account_banned',
      moderatedAtMs: now,
      updatedAtMs: now,
      updatedAt: db.serverDate()
    }
  })));
  return activeIds.length;
}

async function setUserStatus(userId, status, reason, adminOpenId) {
  const targetId = text(userId, 100);
  if (!targetId) throw new Error('用户不存在');
  if (targetId === adminOpenId) throw new Error('不能修改自己的管理员账号');
  if (await getAdmin(targetId)) throw new Error('不能封禁管理员账号');
  const profile = await getDocument(USER_PROFILES, targetId);
  if (!profile) throw new Error('用户不存在');
  const now = Date.now();
  if (status === 'banned') {
    await unlistOwnedItems(targetId);
    await db.collection(USER_PROFILES).doc(targetId).update({
      data: {
        status: 'banned',
        banReason: text(reason, 200) || '违反平台规则',
        bannedAtMs: now,
        bannedAt: db.serverDate(),
        bannedBy: adminOpenId,
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    });
  } else {
    await db.collection(USER_PROFILES).doc(targetId).update({
      data: {
        status: 'active',
        banReason: '',
        bannedAtMs: 0,
        bannedBy: '',
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    });
  }
}

async function resolveReport(input, openid) {
  const reportId = text(input.reportId, 100);
  const decision = text(input.decision, 20);
  if (!reportId || !['dismiss', 'unlist', 'suspend', 'delete', 'ban'].includes(decision)) throw new Error('处理方式无效');
  const report = await getDocument(REPORTS, reportId);
  if (!report) throw new Error('举报记录不存在');
  if (report.status !== 'pending') throw new Error('该举报已经处理');
  let item = null;
  if (report.itemId) item = await getDocument(MARKET_ITEMS, report.itemId);
  const ownerOpenId = text((item && item.ownerOpenId) || report.itemOwnerOpenId, 100);
  const now = Date.now();
  if (['unlist', 'suspend', 'delete', 'ban'].includes(decision)) {
    if (!item) throw new Error('内容已经不存在');
    const itemStatus = decision === 'delete' ? 'deleted' : 'suspended';
    await db.collection(MARKET_ITEMS).doc(item._id).update({
      data: {
        status: itemStatus,
        moderationReason: text(input.note, 200) || report.reason,
        moderatedAtMs: now,
        moderatedBy: openid,
        deletedAtMs: itemStatus === 'deleted' ? now : number(item.deletedAtMs),
        deletedBy: itemStatus === 'deleted' ? 'admin' : text(item.deletedBy, 30),
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    });
  }
  if (decision === 'ban') {
    await setUserStatus(ownerOpenId, 'banned', input.note || report.reason, openid);
  }
  await db.collection(REPORTS).doc(reportId).update({
    data: {
      status: decision === 'dismiss' ? 'dismissed' : 'actioned',
      resolution: decision,
      resolutionNote: text(input.note, 200),
      resolvedAtMs: now,
      resolvedAt: db.serverDate(),
      resolvedBy: openid,
      updatedAtMs: now,
      updatedAt: db.serverDate()
    }
  });
  await logAdminOperation(openid, `resolve_report_${decision}`, 'report', reportId, input.note || report.reason);
}

exports.main = async (event) => {
  const input = event || {};
  const action = input.action || 'status';
  const openid = cloud.getWXContext().OPENID;
  if (!openid) throw new Error('无法识别当前微信用户');

  if (action === 'status') {
    return { ok: true, isAdmin: !!(await getAdmin(openid)) };
  }

  if (action === 'submitReport') {
    return { ok: true, reportId: await submitReport(input, openid) };
  }

  if (action === 'submitUserReport') {
    return { ok: true, reportId: await submitUserReport(input, openid) };
  }

  if (action === 'relationship') {
    return { ok: true, ...(await getBlockRelationship(input, openid)) };
  }

  if (action === 'blockUser') {
    return { ok: true, ...(await toggleBlockUser(input, openid)) };
  }

  if (action === 'listBlockedUsers') {
    return { ok: true, users: await listBlockedUsers(openid) };
  }

  if (action === 'unblockUser') {
    return { ok: true, removed: await unblockUser(input, openid) };
  }

  await assertAdmin(openid);

  if (action === 'listReports') return { ok: true, reports: await listReports() };
  if (action === 'listItems') return { ok: true, items: await listItems() };
  if (action === 'listUsers') return { ok: true, users: await listUsers() };

  if (action === 'resolveReport') {
    await resolveReport(input, openid);
    return { ok: true };
  }

  if (action === 'unlistItem') {
    const itemId = text(input.itemId, 100);
    const item = await getDocument(MARKET_ITEMS, itemId);
    if (!item) throw new Error('内容不存在');
    const now = Date.now();
    await db.collection(MARKET_ITEMS).doc(itemId).update({
      data: { status: 'suspended', moderatedAtMs: now, moderatedBy: openid, updatedAtMs: now, updatedAt: db.serverDate() }
    });
    await logAdminOperation(openid, 'suspend_item', 'item', itemId, input.reason || '管理员暂停');
    return { ok: true };
  }

  if (action === 'setItemStatus') {
    const itemId = text(input.itemId, 100);
    const status = text(input.status, 20);
    if (!['active', 'unlisted', 'suspended', 'deleted'].includes(status)) throw new Error('内容状态无效');
    const item = await getDocument(MARKET_ITEMS, itemId);
    if (!item) throw new Error('内容不存在');
    if (status === 'active') contentPolicy.assertAllowed(item);
    const now = Date.now();
    await db.collection(MARKET_ITEMS).doc(itemId).update({
      data: {
        status,
        moderationReason: text(input.reason, 200),
        moderatedAtMs: now,
        moderatedBy: openid,
        deletedAtMs: status === 'deleted' ? now : number(item.deletedAtMs),
        deletedBy: status === 'deleted' ? 'admin' : text(item.deletedBy, 30),
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    });
    await logAdminOperation(openid, `set_item_${status}`, 'item', itemId, input.reason || '');
    return { ok: true };
  }

  if (action === 'setUserStatus') {
    const status = input.status === 'banned' ? 'banned' : 'active';
    await setUserStatus(input.userId, status, input.reason, openid);
    await logAdminOperation(openid, `set_user_${status}`, 'user', input.userId, input.reason || '');
    return { ok: true };
  }

  throw new Error('不支持的操作');
};
