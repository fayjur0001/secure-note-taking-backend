const mongoose = require('mongoose');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Parse ?page=&limit= from the query string.
 * limit is capped so a client can never ask for the whole collection at once.
 */
function getPagination(query, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * We fetch `limit + 1` documents: if the extra one exists there is a next page.
 * This avoids running a separate countDocuments() query on every list request.
 */
function paginated(items, { page, limit }) {
  return {
    data: items.slice(0, limit),
    pagination: { page, limit, hasMore: items.length > limit },
  };
}

function toObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, `Invalid ${label}`);
  return new mongoose.Types.ObjectId(String(id));
}

/** Copy only whitelisted keys from the body (prevents mass-assignment, e.g. role). */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

module.exports = { HttpError, getPagination, paginated, toObjectId, pick };
