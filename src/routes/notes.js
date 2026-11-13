const { Router } = require('express');
const Note = require('../models/Note');
const { authenticate } = require('../middleware/auth');
const { HttpError, getPagination, paginated, toObjectId, pick } = require('../utils/http');

const router = Router();
router.use(authenticate);

/**
 * Ownership filter. Admins may *view* everyone's notes (spec), but only the
 * owner can modify their own notes.
 */
const readFilter = (req, id) =>
  req.user.role === 'admin' ? { _id: id } : { _id: id, owner: req.user.id };
const writeFilter = (req, id) => ({ _id: id, owner: req.user.id });

// GET /api/notes?page=&limit= — own notes, newest first. Index: { owner: 1, _id: -1 }
router.get('/', async (req, res) => {
  const p = getPagination(req.query);
  const items = await Note.find({ owner: req.user.id })
    .sort({ _id: -1 })
    .skip(p.skip)
    .limit(p.limit + 1)
    .lean();
  res.json(paginated(items, p));
});

// POST /api/notes
router.post('/', async (req, res) => {
  const note = await Note.create({ ...pick(req.body, ['title', 'content']), owner: req.user.id });
  res.status(201).json({ note });
});

// GET /api/notes/:id — _id index
router.get('/:id', async (req, res) => {
  const note = await Note.findOne(readFilter(req, toObjectId(req.params.id))).lean();
  if (!note) throw new HttpError(404, 'Note not found');
  res.json({ note });
});

// PUT /api/notes/:id — _id index
router.put('/:id', async (req, res) => {
  const note = await Note.findOneAndUpdate(
    writeFilter(req, toObjectId(req.params.id)),
    { $set: pick(req.body, ['title', 'content']) },
    { returnDocument: 'after', runValidators: true }
  ).lean();
  if (!note) throw new HttpError(404, 'Note not found');
  res.json({ note });
});

// DELETE /api/notes/:id — _id index
router.delete('/:id', async (req, res) => {
  const result = await Note.deleteOne(writeFilter(req, toObjectId(req.params.id)));
  if (result.deletedCount === 0) throw new HttpError(404, 'Note not found');
  res.status(204).end();
});

module.exports = router;
