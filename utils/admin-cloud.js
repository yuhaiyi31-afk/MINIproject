const FUNCTION_NAME = 'admin-api';

function ensureCloud() {
  if (!wx.cloud || !wx.cloud.callFunction) throw new Error('当前小程序尚未开通管理云服务');
}

async function call(action, data) {
  ensureCloud();
  const response = await wx.cloud.callFunction({
    name: FUNCTION_NAME,
    data: { action, ...(data || {}) }
  });
  const result = response && response.result;
  if (!result || result.ok !== true) throw new Error((result && result.message) || '管理云服务返回异常');
  return result;
}

async function getStatus() {
  const result = await call('status');
  return !!result.isAdmin;
}

async function submitReport(report) {
  const result = await call('submitReport', report);
  return result.reportId;
}

async function submitUserReport(report) {
  const result = await call('submitUserReport', report);
  return result.reportId;
}

async function getRelationship(itemId) {
  const result = await call('relationship', { itemId });
  return { blocked: !!result.blocked, canBlock: !!result.canBlock };
}

async function setUserBlocked(itemId, blocked) {
  const result = await call('blockUser', { itemId, blocked: !!blocked });
  return !!result.blocked;
}

async function listBlockedUsers() {
  const result = await call('listBlockedUsers');
  return result.users || [];
}

async function unblockUser(userId) {
  const result = await call('unblockUser', { userId });
  return !!result.removed;
}

async function listReports() {
  const result = await call('listReports');
  return result.reports || [];
}

async function listItems() {
  const result = await call('listItems');
  return result.items || [];
}

async function listUsers() {
  const result = await call('listUsers');
  return result.users || [];
}

async function resolveReport(reportId, decision, note) {
  await call('resolveReport', { reportId, decision, note: note || '' });
}

async function unlistItem(itemId) {
  await call('unlistItem', { itemId });
}

async function setItemStatus(itemId, status, reason) {
  await call('setItemStatus', { itemId, status, reason: reason || '' });
}

async function setUserStatus(userId, status, reason) {
  await call('setUserStatus', { userId, status, reason: reason || '' });
}

function getErrorMessage(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  if (message.includes('FunctionName') || message.includes('function')) return '云函数 admin-api 尚未部署';
  if (message.includes('market_reports') || message.includes('collection') || message.includes('-502005')) {
    return '管理集合尚未创建，请先创建 market_reports 和 app_admins';
  }
  if (message.includes('无管理员权限')) return '当前账号没有管理员权限';
  return message || '管理云服务暂时不可用';
}

module.exports = {
  getStatus,
  submitReport,
  submitUserReport,
  getRelationship,
  setUserBlocked,
  listBlockedUsers,
  unblockUser,
  listReports,
  listItems,
  listUsers,
  resolveReport,
  unlistItem,
  setItemStatus,
  setUserStatus,
  getErrorMessage
};
