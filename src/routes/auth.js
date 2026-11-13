const { Router } = require('express');
const User = require('../models/User');
const { signToken, authenticate } = require('../middleware/auth');
const { HttpError, pick } = require('../utils/http');

const router = Router();

// POST /api/auth/register — public sign-up, always creates role "user"
router.post('/register', async (req, res) => {
  const body = pick(req.body, ['name', 'email', 'password', 'interests']);
  const user = await User.create({ ...body, role: 'user' });
  res.status(201).json({ token: signToken(user), user });
});

// POST /api/auth/login — uses the { email: 1 } unique index
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'email and password are required');
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  // same message for unknown email and wrong password (no user enumeration)
  if (!user || !(await user.comparePassword(password))) throw new HttpError(401, 'Invalid email or password');
  res.json({ token: signToken(user), user });
});

// GET /api/auth/me — own profile, _id index
router.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ user });
});

// PATCH /api/auth/me — update own name / interests / password (never role)
router.patch('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id);
  Object.assign(user, pick(req.body, ['name', 'interests', 'password']));
  await user.save(); // pre('save') re-hashes the password if it changed
  res.json({ user });
});

module.exports = router;
