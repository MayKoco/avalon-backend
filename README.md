# Shadows of Camelot — Backend

NestJS, Socket.IO, Prisma, and SQLite backend for a LAN multiplayer social-deduction game. The server owns roles, role knowledge, game transitions, votes, quest submissions, timers, and victory resolution.

## Local setup

Requirements: Node.js 22+ and pnpm 10+.

```bash
cp .env.example .env
pnpm install
pnpm prisma:generate
pnpm prisma:migrate
pnpm start:dev
```

The API and Socket.IO server listen on `0.0.0.0:4000`. Replace `REJOIN_TOKEN_PEPPER` before hosting a real game.

For phones on the same Wi-Fi, find the host machine's LAN address and configure the frontend with `http://<LAN-IP>:4000`.

## Verification

```bash
pnpm test
pnpm build
```

## Docker

```bash
docker compose up --build
```

SQLite data is kept in the `avalon-data` volume. The container applies committed migrations before starting.

## Security model

- A random opaque rejoin token authenticates each player; only its SHA-256 hash plus a server-side pepper is stored.
- Public snapshots exclude role assignments and individual quest submissions.
- Role knowledge is calculated server-side for the requesting player.
- State changes use optimistic state versions and SQLite transactions.
- Phase expiration is processed by the server and remains tied to persisted deadlines.

See [task.md](task.md) for the delivery checklist and remaining work.
