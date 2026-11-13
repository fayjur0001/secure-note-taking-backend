const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------------------------
 * INDEXES (posts collection)
 *
 * { author: 1, _id: -1 }  -> Scenario 2: users.aggregate([$match, $lookup])
 *                            The $lookup joins users._id -> posts.author and its
 *                            sub-pipeline sorts by _id desc then skip/limit.
 *                            Equality on author + sort on _id => IXSCAN for every
 *                            looked-up user, no collection scan, no in-memory sort.
 *                            Also serves deleteMany({ author }) when a user is removed.
 * ------------------------------------------------------------------------- */
postSchema.index({ author: 1, _id: -1 });

postSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Post', postSchema);
