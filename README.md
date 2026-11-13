# Secure Notes — Backend (REST API)

Node.js + Express 5 + MongoDB (Mongoose) + JWT. Note-taking API with role-based access control,
a minimal set of indexes, and two aggregation pipelines.

| | |
|---|---|
| Live app (frontend) | http://150.241.228.137:8096 |
| Live API | http://150.241.228.137:8096/api (health check: [`/health`](http://150.241.228.137:8096/health)) |
| Backend repo | https://github.com/fayjur0001/secure-note-taking-backend |
| Frontend repo | https://github.com/fayjur0001/secure-note-taking-frontend |

The frontend and the API are served from the same VPS on the same origin (see [Deployment](#deployment)).
Admin credentials for testing are in the submission email.

## Run locally

```bash
cp .env.example .env        # set MONGODB_URI and JWT_SECRET
npm install
npm run create-admin        # creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                 # http://localhost:3000
```

Public registration always creates a `user`. Admins are created with `npm run create-admin`
or by another admin through the API.

To also serve the frontend from this server (same origin, as in production), clone the
frontend repo next to `src/` as `frontend/` and start with `STATIC_DIR=frontend npm run dev`.

## Project structure

```
src/
  models/          User, Note, Post — schemas + every schema.index()
  services/        aggregations.js — Scenario 1 and Scenario 2 pipelines
  routes/          auth, notes, posts, users (aggregation endpoints), admin
  middleware/      JWT auth + role check, error handler
  utils/http.js    pagination, ObjectId validation, body whitelisting
scripts/createAdmin.js
Dockerfile, compose.yaml, deploy/   self-hosted deployment
```

## Security

- Passwords are hashed with **bcrypt** (cost 12): in a `pre('save')` hook on create, and in `User.prepareUpdate()` on updates. The password field is `select: false` and is removed from every JSON response.
- User updates are a single atomic `findByIdAndUpdate({ $set })` (with validators), not load + `save()`, so concurrent edits of the same user can't fail with a Mongoose `VersionError`.
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

## Deployment

The live app runs on a Linux VPS with Docker, as **one container** (`secure-notes-api`): the
Node API serves the REST endpoints and, because `STATIC_DIR` is set, the frontend's static files
on the same origin. The database is **MongoDB Atlas**, so no database container runs on the server.

```
/opt/secure-notes/            <- this repo (git clone)
/opt/secure-notes/frontend/   <- frontend repo (git clone, ignored by this repo)
/opt/secure-notes/.env        <- secrets, created on the server only
```

- `Dockerfile`: `node:22-alpine`, production deps only (`npm ci --omit=dev`), runs as the non-root `node` user, with a `/health` healthcheck.
- `compose.yaml`: publishes host port `8096`, mounts `frontend/` read-only, and limits memory to 256 MB.
- `deploy/web-config.js` is mounted over the frontend's `config.js` and sets `API_URL = ''`, so the browser calls `/api/...` on the same origin. Because of that, CORS is not needed in production.

Environment variables (`.env`): `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`.

### First deploy

```bash
git clone https://github.com/fayjur0001/secure-note-taking-backend.git /opt/secure-notes
git clone https://github.com/fayjur0001/secure-note-taking-frontend.git /opt/secure-notes/frontend
# create /opt/secure-notes/.env (chmod 600)
docker compose -p secure-notes -f /opt/secure-notes/compose.yaml build
docker compose -p secure-notes -f /opt/secure-notes/compose.yaml up -d
```

The first admin was created once with `npm run create-admin`, pointed at the same Atlas database.

### Redeploy

```bash
tar czf /root/secure-notes-backup-$(date +%F-%H%M).tgz -C /opt/secure-notes .
cd /opt/secure-notes && git pull && git -C frontend pull
docker compose -p secure-notes -f /opt/secure-notes/compose.yaml build
docker compose -p secure-notes -f /opt/secure-notes/compose.yaml up -d
```

A frontend-only change needs only `git -C frontend pull`, because the folder is mounted.

Mongoose builds the indexes on startup (`autoIndex`).
