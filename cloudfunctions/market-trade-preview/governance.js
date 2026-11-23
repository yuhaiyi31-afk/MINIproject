'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { collections, ID, TradeError, check, hash, id, itemKey, array, label } = require('./shared');
const { attachAssets } = require('./media');
const { favoriteItem, publicField } = require('./items');
const { assertAllowed } = require('./content-policy');

const REPORT_REASONS = ['疑似诈骗', '禁售或违法物品', '虚假描述', '侵权或仿冒', '骚扰或不当行为', '其他'];
const ITEM_STATES = ['ACTIVE', 'UNLISTED', 'SUSPENDED', 'DELETED'];

function time(value) {
  return Number(value) || 0;
}

function publicName(value) {
  try {
    return publicField(value, 40, '昵称');
  } catch {
    return '用户';
  }
}

function profileView(profile) {
  return {
    nickName: publicName(profile?.nickName),
    sellerType: profile?.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
    registeredAtMs: time(profile?.registeredAtMs)
  };
}

function auditReason(value) {
  check(typeof value === 'string' && value.trim().length >= 4 && value.trim().length <= 200,
    'ADMIN_REASON', '请填写 4 至 200 字的审核依据');
  return value.trim();
}

function legacyToken(prefix, value) {
  return prefix + '_' + createHash('sha256').update(value).digest('hex').slice(0, 40);
}

function blockedIds(profile) {
  return [...new Set(array(profile.blockedUserIds).filter(value => typeof value === 'string' && ID.test(value)))];
}

function visibleItem(item) {
  return item?.status === 'active' && ['market', 'service'].includes(item.publishType);
}

function createGovernance({ account, store, now, mediaRoot, signFiles, scopedQuery }) {
  async function adminAccount(tx, principal) {
    const current = await account(tx, principal);
    const admin = await tx.get(collections.admins, current.openId);
    check(admin?.enabled === true, 'ADMIN_REQUIRED', '无管理员权限');
    return current;
  }

  async function signAvatar(value) {
    const prefix = 'cloud://' + mediaRoot + '/';
    const path = typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : '';
    if (!mediaRoot || !/^(?:users\/avatars|market\/images)\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/.test(path) || !signFiles) return null;
    try {
      const result = await signFiles([{ fileID: value, maxAge: 300 }]);
      const file = result.fileList?.find(row => row.fileID === value && (row.status == null || row.status === 0));
      return /^https:\/\//i.test(file?.tempFileURL || '') ? { url: file.tempFileURL } : null;
    } catch {
      return null;
    }
  }

  async function sellerTarget(tx, input) {
    const item = await tx.get(collections.items, itemKey(input.itemId));
    check(visibleItem(item) && typeof item.ownerOpenId === 'string' && ID.test(item.ownerOpenId),
      'ITEM_UNAVAILABLE', '该内容不存在或已下架');
    return item;
  }

  async function writeAudit(tx, adminId, action, targetType, targetId, detail, changedAt) {
    const auditId = 'audit_' + randomUUID().replace(/-/g, '');
    await tx.add(collections.audit, auditId, {
      adminOpenId: adminId, action, targetType, targetId, detail, createdAtMs: changedAt, createdAt: new Date(changedAt)
    });
  }

  async function changeItemState(tx, item, target, actor, reason, changedAt) {
    check(item && ['market', 'service'].includes(item.publishType), 'ITEM_UNAVAILABLE', '内容不存在');
    if (item.status === target) return false;
    check(!['deleting', 'deleted'].includes(item.status), 'ITEM_STATE', '已删除内容不能恢复');
    if (target === 'active') {
      const owner = await tx.get(collections.profiles, id(item.ownerOpenId));
      check(owner?.status === 'active', 'ITEM_STATE', '发布者账号当前无法上架');
      try { assertAllowed(item); } catch (error) { throw new TradeError('ITEM_POLICY', error.message); }
    }
    await tx.update(collections.items, item._id, {
      status: target, moderationReason: reason, moderatedAtMs: changedAt, moderatedBy: actor,
      statusChangedAtMs: changedAt, statusChangedBy: 'admin', updatedAtMs: changedAt, updatedAt: new Date(changedAt),
      ...(target === 'deleted' ? { deletedAtMs: changedAt, deletedBy: 'admin' } : {})
    });
    return true;
  }

  const actions = {
    'profile.save': async (tx, principal, input) => {
      const { openId, profile } = await account(tx, principal);
      const nickName = publicField(input.nickName, 30, '昵称');
      const updatedAtMs = now();
      const changes = { nickName, updatedAtMs, updatedAt: new Date(updatedAtMs) };
      if (input.avatarAssetId !== undefined) {
        const avatarId = id(input.avatarAssetId);
        const [avatarUrl] = await attachAssets(tx, [avatarId], 'profile_' + hash(openId).slice(0, 40), openId, mediaRoot, now);
        changes.avatarUrl = avatarUrl;
      }
      await tx.update(collections.profiles, openId, changes);
      return { profile: profileView({ ...profile, ...changes }) };
    },

    'blocks.relationship': async (tx, principal, input) => {
      const { openId, profile } = await account(tx, principal);
      const item = await sellerTarget(tx, input);
      const seller = await tx.get(collections.profiles, item.ownerOpenId);
      return { blocked: blockedIds(profile).includes(item.ownerOpenId), canBlock: item.ownerOpenId !== openId, seller: profileView(seller) };
    },

    'blocks.toggle': async (tx, principal, input) => {
      const { openId, profile } = await account(tx, principal);
      const ids = blockedIds(profile);
      check(typeof input.blocked === 'boolean', 'BLOCK_STATE', '请选择拉黑或取消拉黑');
      let target;
      if (input.itemId) {
        target = (await sellerTarget(tx, input)).ownerOpenId;
        check(target !== openId, 'BLOCK_SELF', '不能拉黑自己');
      } else {
        const blockedId = id(input.userId);
        check(!input.blocked, 'BLOCK_TARGET', '请从商品或服务详情拉黑');
        target = ids.find(openId => legacyToken('blocked_user', openId) === blockedId);
        if (!target) return { blocked: false };
      }
      if (ids.includes(target) === input.blocked) return { blocked: input.blocked };
      check(!input.blocked || ids.length < 100, 'BLOCK_LIMIT', '拉黑名单已满，请先移除一位用户');
      const blockedUserIds = input.blocked ? [target, ...ids] : ids.filter(value => value !== target);
      const updatedAtMs = now();
      await tx.update(collections.profiles, openId, { blockedUserIds, updatedAtMs, updatedAt: new Date(updatedAtMs) });
      return { blocked: input.blocked };
    },

    'blocks.filterListings': async (tx, principal, input) => {
      const { profile } = await account(tx, principal);
      const ids = input.itemIds;
      check(Array.isArray(ids) && ids.length <= 30, 'ITEM_LIST', '内容列表无效');
      const blocked = new Set(blockedIds(profile));
      const listingIds = [...new Set(ids.map(itemKey))];
      if (!blocked.size) return { hiddenIds: [] };
      const hiddenIds = [];
      for (const itemId of listingIds) {
        const item = await tx.get(collections.items, itemId);
        if (visibleItem(item) && blocked.has(item.ownerOpenId)) hiddenIds.push(itemId);
      }
      return { hiddenIds };
    },

    'reports.submit': async (tx, principal, input) => {
      const { openId, profile } = await account(tx, principal);
      const item = await sellerTarget(tx, input);
      const isUser = input.targetType === 'USER';
      check(isUser || input.targetType === 'ITEM', 'REPORT_TARGET', '举报类型无效');
      check(item.ownerOpenId !== openId, 'REPORT_SELF', '不能举报自己');
      check(REPORT_REASONS.includes(input.reason), 'REPORT_REASON', '请选择举报原因');
      check(input.detail == null || typeof input.detail === 'string' && input.detail.trim().length <= 300,
        'REPORT_DETAIL', '补充说明最多 300 字');
      const reportId = legacyToken(isUser ? 'user_report' : 'report', openId + ':' + (isUser ? item.ownerOpenId : item._id));
      const existing = await tx.get(collections.reports, reportId);
      if (existing) return { reportId };
      const changedAt = now();
      await tx.add(collections.reports, reportId, {
        targetType: isUser ? 'user' : 'item', ...(isUser ? { targetUserOpenId: item.ownerOpenId } : {}),
        itemId: item._id, itemOwnerOpenId: item.ownerOpenId, itemTitle: label(item.title, 80),
        itemType: item.publishType === 'service' ? 'service' : 'product',
        reason: input.reason, detail: label(input.detail, 300),
        reporterOpenId: openId, reporterName: profileView(profile).nickName, ownerName: publicName(item.publisherNick),
        reporterAvatar: label(profile.avatarUrl, 500), ownerAvatar: label(item.publisherAvatar, 500),
        itemThumb: label(item.thumbnail || array(item.images)[0], 500), status: 'pending',
        createdAtMs: changedAt, updatedAtMs: changedAt, createdAt: new Date(changedAt), updatedAt: new Date(changedAt)
      });
      return { reportId };
    },

    'admin.item.transition': async (tx, principal, input) => {
      const { openId } = await adminAccount(tx, principal);
      const itemId = itemKey(input.itemId);
      const reason = auditReason(input.reason);
      check(ITEM_STATES.includes(input.status), 'ITEM_STATE', '内容状态无效');
      const target = input.status.toLowerCase();
      const item = await tx.get(collections.items, itemId);
      const changedAt = now();
      if (await changeItemState(tx, item, target, openId, reason, changedAt)) {
        await writeAudit(tx, openId, 'set_item_' + target, 'item', itemId, reason, changedAt);
      }
      return { status: input.status };
    },

    'admin.user.status': async (tx, principal, input) => {
      const { openId } = await adminAccount(tx, principal);
      const userId = id(input.userId);
      check(userId !== openId && (await tx.get(collections.admins, userId))?.enabled !== true,
        'ADMIN_TARGET', '不能修改管理员账号');
      check(['BANNED', 'ACTIVE'].includes(input.status), 'ADMIN_STATUS', '账号状态无效');
      const reason = auditReason(input.reason);
      const profile = await tx.get(collections.profiles, userId);
      check(profile, 'PROFILE_REQUIRED', '账号不存在');
      const target = input.status.toLowerCase();
      if (profile.status === target) return { status: input.status };
      const changedAt = now();
      await tx.update(collections.profiles, userId, {
        status: target, banReason: target === 'banned' ? reason : '', bannedAtMs: target === 'banned' ? changedAt : 0,
        bannedBy: target === 'banned' ? openId : '', updatedAtMs: changedAt, updatedAt: new Date(changedAt)
      });
      await writeAudit(tx, openId, 'set_user_' + target, 'user', userId, reason, changedAt);
      return { status: input.status };
    },

    'admin.report.resolve': async (tx, principal, input) => {
      const { openId } = await adminAccount(tx, principal);
      const reportId = id(input.reportId);
      const reason = auditReason(input.resolution);
      check(['DISMISSED', 'ACTIONED'].includes(input.decision), 'REPORT_STATE', '处理方式无效');
      const target = input.decision.toLowerCase();
      const report = await tx.get(collections.reports, reportId);
      if (report?.status === target && report.resolutionNote === reason) return { status: input.decision };
      check(report?.status === 'pending', 'REPORT_STATE', '举报不存在或已经处理');
      const changedAt = now();
      const decision = target === 'dismissed' ? 'dismiss' : 'suspend';
      if (decision === 'suspend' && report.targetType !== 'user') {
        const item = await tx.get(collections.items, itemKey(report.itemId));
        if (visibleItem(item)) await changeItemState(tx, item, 'suspended', openId, reason, changedAt);
      }
      await tx.update(collections.reports, reportId, {
        status: target, resolution: report.targetType === 'user' && target === 'actioned' ? 'reviewed' : decision,
        resolutionNote: reason, resolvedAtMs: changedAt, resolvedBy: openId, resolvedAt: new Date(changedAt),
        updatedAtMs: changedAt, updatedAt: new Date(changedAt)
      });
      await writeAudit(tx, openId, 'resolve_report_' + target, 'report', reportId, reason, changedAt);
      return { status: input.decision };
    }
  };

  const adminViews = {
    REPORTS: row => ({
      id: row._id, _id: row._id, itemId: label(row.itemId, 100), itemTitle: label(row.itemTitle, 80),
      targetType: row.targetType === 'user' ? 'USER' : 'ITEM', reason: label(row.reason, 40), detail: label(row.detail, 300),
      resolutionNote: label(row.resolutionNote, 200), status: String(row.status || 'pending').toUpperCase()
    }),
    ITEMS: row => ({ id: row._id, title: label(row.title, 80), price: time(row.price), status: String(row.status || 'unlisted').toUpperCase() }),
    USERS: row => ({ id: row._id, nickName: publicName(row.nickName), accountStatus: String(row.status || 'active').toUpperCase() }),
    AUDIT: row => ({
      id: row._id, action: label(row.action, 40), targetType: label(row.targetType, 30), targetId: label(row.targetId, 100),
      detail: label(row.detail, 300), createdAtMs: time(row.createdAtMs)
    })
  };

  const queries = {
    'profile.me': async principal => {
      const { result } = await scopedQuery(principal, async (openId, profile) => {
        const admin = await store.transaction(tx => tx.get(collections.admins, openId));
        return {
          profile: { ...profileView(profile), avatar: await signAvatar(profile.avatarUrl) },
          permissions: { isAdmin: admin?.enabled === true }
        };
      });
      return result;
    },
    'users.public': async (principal, input) => {
      const { result } = await scopedQuery(principal, async openId => {
        const { item, seller } = await store.transaction(async tx => {
          const item = await sellerTarget(tx, input);
          const seller = await tx.get(collections.profiles, item.ownerOpenId);
          check(seller?.status === 'active', 'PROFILE_REQUIRED', '发布者资料暂不可用');
          return { item, seller };
        });
        const listings = await store.itemsFor(item.ownerOpenId, 'active', 0, 'market');
        const items = listings.filter(listing => listing.ownerOpenId === item.ownerOpenId && visibleItem(listing)).slice(0, 20).map(favoriteItem);
        return { profile: { ...profileView(seller), avatar: await signAvatar(seller.avatarUrl) }, items, isOwner: openId === item.ownerOpenId };
      });
      return result;
    },
    'blocks.list': async principal => {
      const { result } = await scopedQuery(principal, async (_openId, profile) => {
        const users = [];
        const ids = blockedIds(profile).slice(0, 100);
        for (let start = 0; start < ids.length; start += 20) {
          const group = ids.slice(start, start + 20);
          const rows = await store.profilesById(group);
          const byId = new Map(rows.map(row => [row._id, row]));
          users.push(...await Promise.all(group.map(async openId => {
            const target = byId.get(openId);
            return { id: legacyToken('blocked_user', openId), nickName: publicName(target?.nickName), avatar: await signAvatar(target?.avatarUrl) };
          })));
        }
        return { users };
      });
      return result;
    },
    'admin.list': async (principal, input) => {
      const { openId } = await store.transaction(tx => adminAccount(tx, principal));
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 30;
      check(Object.hasOwn(adminViews, input.type) && Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000
        && Number.isSafeInteger(limit) && limit >= 1 && limit <= 50, 'ADMIN_PAGE', '治理列表页码无效');
      const rows = await store.adminList(input.type, offset, limit + 1);
      const current = await store.transaction(tx => adminAccount(tx, principal));
      check(openId === current.openId, 'LINK_STATE', '账号绑定已发生变化');
      return { records: rows.slice(0, limit).map(adminViews[input.type]), page: { hasMore: rows.length > limit, nextOffset: offset + limit } };
    }
  };

  return { actions, queries };
}

module.exports = { createGovernance };
