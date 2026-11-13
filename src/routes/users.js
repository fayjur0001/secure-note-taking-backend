const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { HttpError, getPagination, paginated, toObjectId } = require('../utils/http');
const { groupUsersByInterests, getUserPosts } = require('../services/aggregations');

const router = Router();

// GET /api/users/interests?interest=&page=&limit=
// Scenario 1 — users grouped by interest (single User.aggregate() call)
router.get('/interests', authenticate, async (req, res) => {
  const p = getPagination(req.query);
  const interest = typeof req.query.interest === 'string' ? req.query.interest.trim().toLowerCase() : '';
  const groups = await groupUsersByInterests({ interest: interest || null, skip: p.skip, limit: p.limit });
  res.json(paginated(groups, p));
});

// GET /api/users/:id/posts?page=&limit=
// Scenario 2 — posts of one user via $lookup. Posts are public, so no auth required.
router.get('/:id/posts', async (req, res) => {
  const p = getPagination(req.query);
  const result = await getUserPosts({ userId: toObjectId(req.params.id), skip: p.skip, limit: p.limit });
  if (!result) throw new HttpError(404, 'User not found');
  const { data, pagination } = paginated(result.posts, p);
  res.json({ user: { _id: result._id, name: result.name }, data, pagination });
});

module.exports = router;
