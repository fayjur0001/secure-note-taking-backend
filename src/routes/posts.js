const { Router } = require('express');
const Post = require('../models/Post');
const { authenticate } = require('../middleware/auth');
const { HttpError, toObjectId, pick } = require('../utils/http');

const router = Router();

// POST /api/posts — any logged-in user can write a post
router.post('/', authenticate, async (req, res) => {
  const post = await Post.create({ ...pick(req.body, ['title', 'body']), author: req.user.id });
  res.status(201).json({ post });
});

// DELETE /api/posts/:id — author only; _id index
router.delete('/:id', authenticate, async (req, res) => {
  const result = await Post.deleteOne({ _id: toObjectId(req.params.id), author: req.user.id });
  if (result.deletedCount === 0) throw new HttpError(404, 'Post not found');
  res.status(204).end();
});

// Reading posts of a user lives in routes/users.js (GET /api/users/:id/posts, Scenario 2).

module.exports = router;
