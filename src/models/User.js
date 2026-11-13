const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { HttpError } = require('../utils/http');

const ROLES = ['user', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // NOTE: no `unique: true` / `index: true` here on purpose.
    // Every index is declared below with schema.index() so it is visible in one place.
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ROLES, default: 'user' },
    interests: {
      type: [String],
      default: [],
      // normalise: trim + lowercase + de-duplicate, so "Chess" and "chess " end up in one group
      set: (arr) => [...new Set((arr || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))],
    },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------------------------
 * INDEXES (users collection)
 *
 * _id (automatic)        -> GET /users/:id, GET /auth/me, auth middleware lookup,
 *                           admin "list users" (paginated, sorted by _id desc),
 *                           Scenario 2 $match { _id } before $lookup.
 *
 * { email: 1 } unique    -> login looks a user up by email; also enforces
 *                           one-account-per-email at the database level.
 *
 * { interests: 1 }       -> multikey index. Scenario 1 (group by interests)
 *                           starts with a $match on `interests`, which runs as
 *                           an IXSCAN on this index (and skips users with no
 *                           interests entirely).
 *
 * Deliberately NOT indexed: role, name, createdAt — no query filters/sorts on them.
 * ------------------------------------------------------------------------- */
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ interests: 1 });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, config.bcryptRounds);
});

/**
 * Updates go through atomic findByIdAndUpdate($set) instead of load + save(),
 * so concurrent edits of the same user can't fail with a VersionError.
 * The pre('save') hook doesn't run for updates, so hash the password here.
 */
userSchema.statics.prepareUpdate = async function prepareUpdate(updates) {
  if (updates.password !== undefined) {
    if (typeof updates.password !== 'string' || updates.password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }
    updates.password = await bcrypt.hash(updates.password, config.bcryptRounds);
  }
  return updates;
};

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);
User.ROLES = ROLES;

module.exports = User;
