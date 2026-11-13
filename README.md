# Secure Notes — Backend (REST API)

Node.js + Express 5 + MongoDB (Mongoose) + JWT. Note-taking API with role-based access control,
a minimal set of indexes, and two aggregation pipelines.

- **Live API:** `<add Render URL here>`
- **Frontend repo / live site:** `<add links here>`

## Run locally

```bash
cp .env.example .env        # set MONGODB_URI and JWT_SECRET
npm install
npm run create-admin        # creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                 # http://localhost:3000
```

Public registration always creates a `user`. Admins are created with `npm run create-admin`
or by another admin through the API.

## Security

- Passwords are hashed with **bcrypt** (cost 12) in a `pre('save')` hook. The password field is `select: false` and is removed from every JSON response.
- **JWT** (HS256, algorithm pinned on verify) is sent as `Authorization: Bearer <token>`. On every request the user is loaded again, so a deleted user or a changed role takes effect immediately.
- Request bodies are whitelisted (`pick`), so a client cannot send fields such as `role` or `owner` itself.
- A user can only read or write notes where `owner = self`. An admin can **view** all notes but can only modify their own.
- Login returns the same error for an unknown email and a wrong password.

## API

All list endpoints are paginated with `?page=1&limit=10` (max 50). The response looks like
`{ data: [...], pagination: { page, limit, hasMore } }`. The API fetches `limit + 1` documents to
compute `hasMore`, so no extra `countDocuments()` query runs on each request.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | public | `{ name, email, password, interests[] }` |
| POST | `/api/auth/login` | public | returns `{ token, user }` |
| GET | `/api/auth/me` | user | own profile |
| PATCH | `/api/auth/me` | user | update own `name`, `interests`, `password` |
| GET | `/api/notes` | user | own notes, newest first, paginated |
| POST | `/api/notes` | user | `{ title, content }` |
| GET | `/api/notes/:id` | user (owner) / admin | |
| PUT | `/api/notes/:id` | owner | |
| DELETE | `/api/notes/:id` | owner | |
| GET | `/api/admin/users` | admin | paginated |
| GET | `/api/admin/users/:id` | admin | |
| POST | `/api/admin/users` | admin | can set `role` |
| PUT | `/api/admin/users/:id` | admin | |
| DELETE | `/api/admin/users/:id` | admin | also deletes the user's notes and posts |
| GET | `/api/admin/notes?owner=` | admin | everyone's notes; optional owner filter |
| GET | `/api/users/interests?interest=` | user | **Aggregation Scenario 1** |
| POST | `/api/posts` | user | `{ title, body }` |
| DELETE | `/api/posts/:id` | author | |
| GET | `/api/users/:id/posts` | public | **Aggregation Scenario 2** (`$lookup`) |

## Indexing strategy

Every index is declared with `schema.index()` in `src/models/*`. Schema fields have no
`index: true` or `unique: true`, so all indexes are in one place and none are defined twice.

| Collection | Index | Queries it serves |
|---|---|---|
| users | `_id` (automatic) | `GET /auth/me`, auth middleware, `GET /admin/users/:id`, admin user list (sort `_id` desc), Scenario 2 `$match` |
| users | `{ email: 1 }` **unique** | login lookup; one account per email |
| users | `{ interests: 1 }` (multikey) | Scenario 1 first `$match` |
| notes | `_id` (automatic) | `GET/PUT/DELETE /notes/:id`, admin "all notes" (sort `_id` desc) |
| notes | `{ owner: 1, _id: -1 }` | user's own notes list (equality + sort, no in-memory sort), admin `?owner=` filter, cascade `deleteMany({ owner })` |
| posts | `{ author: 1, _id: -1 }` | Scenario 2 `$lookup` (equality on `author` + sort `_id` desc), cascade `deleteMany({ author })` |

**Indexes I chose not to create:**
- **No `createdAt` index.** Lists are sorted by `_id`. ObjectIds increase with insertion time, so `_id` desc already gives "newest first". The admin lists use the built-in `_id` index, and the per-owner lists use `_id` as the second key of the compound index.
- **No standalone `{ owner: 1 }` or `{ author: 1 }` index.** The compound index already covers queries on its first key.
- **No index on `role`, `name` or `title`.** No query filters or sorts on these fields.
- **No `{ _id, owner }` index for single-note reads.** `_id` is unique, so the `_id` index finds the one document, and checking `owner` on that document costs almost nothing.

### Verified with `explain()`

Each query was run with ~300 users, ~1500 notes and ~900 posts:

```
login findOne(email)        IXSCAN          email_1
GET user by _id             EXPRESS_IXSCAN  _id_
admin list users            IXSCAN          _id_
my notes list               IXSCAN          owner_1__id_-1
GET note {_id, owner}       IXSCAN          _id_
admin all notes             IXSCAN          _id_
admin notes by owner        IXSCAN          owner_1__id_-1
S1 group by interests       IXSCAN          interests_1
S1 ?interest=chess          IXSCAN          interests_1
S2 user posts ($lookup)     EXPRESS_IXSCAN  _id_  + $lookup indexesUsed: author_1__id_-1
```

No query does a `COLLSCAN`.

## Aggregations (`src/services/aggregations.js`)

### Scenario 1: users grouped by interests

The whole view runs as **one `User.aggregate()` call**, including pagination.

```js
[
  { $match: { interests: { $gte: '' } } },   // or { interests: 'chess' } when filtered -> IXSCAN interests_1
  { $project: { name: 1, interests: 1 } },
  { $unwind: '$interests' },
  // (+ $match { interests } again when filtered, to drop the user's other interests)
  { $group: { _id: '$interests', count: { $sum: 1 }, users: { $push: { _id: '$_id', name: '$name' } } } },
  { $sort: { count: -1, _id: 1 } },
  { $skip: skip }, { $limit: limit + 1 },
  { $project: { _id: 0, interest: '$_id', count: 1, users: { $slice: ['$users', 20] } } },
]
```

The first `$match` is the only stage that can use an index. `{ $gte: '' }` matches every string
interest, so it runs as an index scan over the multikey index and skips users with no interests.
Without it, `$unwind` would start with a collection scan. When `?interest=` is given, the scan
reads only that one index key.

### Scenario 2: posts of one user (`$lookup`)

```js
User.aggregate([
  { $match: { _id: userId } },                           // _id index
  { $project: { name: 1 } },
  { $lookup: {
      from: 'posts', localField: '_id', foreignField: 'author',
      pipeline: [ { $sort: { _id: -1 } }, { $skip }, { $limit: limit + 1 }, { $project: {...} } ],
      as: 'posts',
  } },                                                   // posts { author: 1, _id: -1 }
])
```

This uses `localField`/`foreignField` together with a sub-pipeline (MongoDB 5.0+). The join
condition and the sort are both served by the compound index, and pagination happens inside the
lookup, so the API never loads all of a user's posts. The pipeline also returns 404 when the
user does not exist.

## Deploy (Render)

1. Create a free **MongoDB Atlas** cluster and copy its connection string. Under Network Access, allow `0.0.0.0/0` so Render can connect.
2. On Render, create a **New Web Service** from this repo. Use `npm install` as the build command and `npm start` as the start command.
3. Set these environment variables: `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN=1d`, `CORS_ORIGIN=<frontend URL>`.
4. Create the admin once from your machine: put the Atlas `MONGODB_URI` in `.env`, then run `npm run create-admin`.

Mongoose builds the indexes on startup (`autoIndex`).
