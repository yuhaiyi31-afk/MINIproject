'use strict';

const { createHash } = require('node:crypto');

const collections = Object.freeze({
  links: 'market_identity_links',
  invites: 'market_identity_invites',
  profiles: 'user_profiles',
  items: 'market_items',
  conversations: 'market_conversations',
  notifications: 'market_notifications',
  media: 'market_trade_media',
  limits: 'market_trade_limits'
});
const ID = /^[A-Za-z0-9_-]{1,128}$/;

class TradeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function check(condition, code, message) {
  if (!condition) throw new TradeError(code, message);
}

function hash(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function id(value) {
  check(typeof value === 'string' && ID.test(value), 'INVALID_ID', '编号无效');
  return value;
}

function itemKey(value) {
  const itemId = id(value);
  check(itemId.length <= 100, 'INVALID_ID', '商品编号无效');
  return itemId;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function label(value, length) {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

module.exports = { collections, ID, TradeError, check, hash, id, itemKey, array, label };
