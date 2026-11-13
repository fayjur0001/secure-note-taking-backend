const User = require('../models/User');
const Post = require('../models/Post');

/**
 * Builds the Scenario 1 pipeline (exported separately so scripts/explain.js
 * can run .explain() on the exact same pipeline the API uses).
 *
 * Index used: users { interests: 1 } (multikey) by the first $match.
 *  - With ?interest=chess  -> point lookup on the "chess" key only.
 *  - Without a filter      -> { interests: { $gte: '' } } matches every string
 *    interest, so the planner scans the multikey index over ["", {}) and never
 *    touches users that have no interests. (A bare $unwind would be a COLLSCAN.)
 */
function groupByInterestsPipeline({ interest, skip, limit, usersPerGroup = 20 }) {
  const firstMatch = interest ? { interests: interest } : { interests: { $gte: '' } };

  return [
    { $match: firstMatch }, // IXSCAN on { interests: 1 }
    { $project: { name: 1, interests: 1 } }, // carry only what we need through the pipeline
    { $unwind: '$interests' }, // one doc per (user, interest)
    // when filtering, drop the user's *other* interests after unwinding
    ...(interest ? [{ $match: { interests: interest } }] : []),
    {
      $group: {
        _id: '$interests',
        count: { $sum: 1 },
        users: { $push: { _id: '$_id', name: '$name' } },
      },
    },
    { $sort: { count: -1, _id: 1 } }, // most popular interests first, ties alphabetical
    { $skip: skip },
    { $limit: limit + 1 }, // +1 => tells us if there is another page
    {
      $project: {
        _id: 0,
        interest: '$_id',
        count: 1,
        users: { $slice: ['$users', usersPerGroup] }, // keep response size bounded
      },
    },
  ];
}

/**
 * Scenario 1: users grouped by interests.
 * Exactly ONE collection.aggregate() call — no find/count/etc.
 */
function groupUsersByInterests(opts) {
  return User.aggregate(groupByInterestsPipeline(opts));
}

/**
 * Builds the Scenario 2 pipeline.
 *
 * Indexes used:
 *  - users _id index            -> $match { _id }
 *  - posts { author: 1, _id: -1 } -> the $lookup equality (author = user._id)
 *                                    plus the $sort { _id: -1 } inside the sub-pipeline.
 */
function userPostsPipeline({ userId, skip, limit }) {
  return [
    { $match: { _id: userId } },
    { $project: { name: 1 } },
    {
      $lookup: {
        from: Post.collection.name,
        localField: '_id',
        foreignField: 'author',
        // localField/foreignField + pipeline together (MongoDB 5.0+)
        pipeline: [
          { $sort: { _id: -1 } }, // newest first, served by { author: 1, _id: -1 }
          { $skip: skip },
          { $limit: limit + 1 },
          { $project: { title: 1, body: 1, createdAt: 1 } },
        ],
        as: 'posts',
      },
    },
  ];
}

/** Scenario 2: all posts of one user, via a single pipeline with $lookup. */
async function getUserPosts(opts) {
  const [result] = await User.aggregate(userPostsPipeline(opts));
  return result || null;
}

module.exports = {
  groupByInterestsPipeline,
  groupUsersByInterests,
  userPostsPipeline,
  getUserPosts,
};
