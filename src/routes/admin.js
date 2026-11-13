const { Router } = require('express');
const User = require('../models/User');
const Note = require('../models/Note');
const Post = require('../models/Post');
const { authenticate, requireRole } = require('../middleware/auth');
const { HttpError, getPagination, paginated, toObjectId, pick } = require('../utils/http');

const router = Router();
router.use(authenticate, requireRole('admin'));

const USER_FIELDS = ['name', 'email', 'password', 'role', 'interests'];

/* ----------------------------- users ----------------------------------- */

// GET /api/admin/users?page=&limit= — sorted by _id desc => default _id index, no extra index needed
router.get('/users', async (req, res) => {
  const p = getPagination(req.query);
  const items = await User.find().sort({ _id: -1 }).skip(p.skip).limit(p.limit + 1).lean();
  res.json(paginated(items, p));
});

// GET /api/admin/users/:id — _id index
router.get('/users/:id', async (req, res) => {
  const user = await User.findById(toObjectId(req.params.id)).lean();
  if (!user) throw new HttpError(404, 'User not found');
  res.json({ user });
});

// POST /api/admin/users — admin can create users or other admins
router.post('/users', async (req, res) => {
  const user = await User.create(pick(req.body, USER_FIELDS));
  res.status(201).json({ user });
});

// PUT /api/admin/users/:id
router.put('/users/:id', async (req, res) => {
  const id = toObjectId(req.params.id);
  const updates = pick(req.body, USER_FIELDS);
  if (id.equals(req.user.id) && updates.role && updates.role !== 'admin') {
    throw new HttpError(400, 'You cannot remove your own admin role');
  }
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found');
  Object.assign(user, updates);
  await user.save(); // runs validators + password hashing hook
  res.json({ user });
});

// DELETE /api/admin/users/:id — also removes the user's notes and posts
router.delete('/users/:id', async (req, res) => {
  const id = toObjectId(req.params.id);
  if (id.equals(req.user.id)) throw new HttpError(400, 'You cannot delete your own account');
  const result = await User.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw new HttpError(404, 'User not found');
  // both use the leading key of the compound indexes { owner, _id } / { author, _id }
  await Promise.all([Note.deleteMany({ owner: id }), Post.deleteMany({ author: id })]);
  res.status(204).end();
});

/* ----------------------------- notes ----------------------------------- */

// GET /api/admin/notes?page=&limit=&owner=
//  - no owner filter -> sort { _id: -1 } on the default _id index
//  - with ?owner=    -> { owner: 1, _id: -1 } index (same one users use)
router.get('/notes', async (req, res) => {
  const p = getPagination(req.query);
  const filter = req.query.owner ? { owner: toObjectId(req.query.owner, 'owner') } : {};
  const items = await Note.find(filter)
    .sort({ _id: -1 })
    .skip(p.skip)
    .limit(p.limit + 1)
    .populate('owner', 'name email') // one users query by _id $in => _id index
    .lean();
  res.json(paginated(items, p));
});

module.exports = router;
