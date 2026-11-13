const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------------------------
 * INDEXES (notes collection)
 *
 * _id (automatic)          -> GET/PUT/DELETE /notes/:id
 *                             (query is { _id, owner } — _id alone is unique, so
 *                             the _id index finds the single doc, owner is a cheap filter),
 *                             admin "list all notes" (sorted by _id desc).
 *
 * { owner: 1, _id: -1 }    -> a user listing their own notes, newest first:
 *                             find({ owner }).sort({ _id: -1 }).skip().limit()
 *                             Equality on owner + sort on _id => IXSCAN, no in-memory sort.
 *                             Also serves admin "notes of one user" and the
 *                             deleteMany({ owner }) cleanup when a user is removed.
 *
 * Why _id instead of createdAt for ordering? ObjectIds are monotonically
 * increasing with creation time, so sorting by _id gives "newest first" without
 * needing an extra { createdAt } index.
 * ------------------------------------------------------------------------- */
noteSchema.index({ owner: 1, _id: -1 });

noteSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Note', noteSchema);
