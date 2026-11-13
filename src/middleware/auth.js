const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { HttpError } = require('../utils/http');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

/**
 * Verifies the Bearer token, then loads the user by _id (default _id index).
 * Loading the user on each request means a deleted user or a changed role takes
 * effect immediately instead of waiting for the token to expire.
 */
async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Missing or malformed Authorization header');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const user = await User.findById(payload.sub).lean();
  if (!user) throw new HttpError(401, 'User no longer exists');

  req.user = { id: user._id, role: user.role, name: user.name, email: user.email };
  next();
}

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throw new HttpError(403, 'Forbidden');
  next();
};

module.exports = { signToken, authenticate, requireRole };
