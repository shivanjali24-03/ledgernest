# Local development

Everything runs on your machine with free tools.

## 1. Requirements
- Node.js 22+
- PostgreSQL 15+ (`brew install postgresql@17` on macOS, or use a free [Neon](https://neon.tech) database)

## 2. Install
```bash
npm install
npm run build -w @ledgernest/shared
```

## 3. Database
Run a private PostgreSQL just for LedgerNest (data stays in `.pgdata/`, which git ignores):
```bash
initdb -D .pgdata -U postgres --auth=trust
pg_ctl -D .pgdata -o "-p 5433 -k /tmp" -l .pgdata/server.log start
createdb -h /tmp -p 5433 -U postgres ledgernest_dev
createdb -h /tmp -p 5433 -U postgres ledgernest_test
```
Then:
```bash
cp apps/api/.env.example apps/api/.env      # then set JWT_ACCESS_SECRET (see below)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # paste into JWT_ACCESS_SECRET
npm run db:migrate -w @ledgernest/api       # create tables
npm run db:seed -w @ledgernest/api          # create the first Super Admin
```

## 4. Run
```bash
npm run dev:api     # http://localhost:3000/api/v1 · API docs at http://localhost:3000/docs
npm run dev:web     # http://localhost:5173
```

## 5. Test
```bash
npm test                                   # unit tests, all workspaces
npm run test:e2e -w @ledgernest/api        # API end-to-end tests against ledgernest_test
```
The end-to-end tests use `TEST_DATABASE_URL` (default: the local `ledgernest_test` database). They never touch the development database.

## Database changes
1. Edit `apps/api/prisma/schema.prisma` (columns are `snake_case` via `@map`, tables via `@@map`).
2. `npm run db:migrate -w @ledgernest/api -- --name describe-the-change`
3. Commit the schema **and** the new folder in `prisma/migrations`.
