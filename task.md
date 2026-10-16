# Shadows of Camelot — Backend Implementation Tasks

## Goal

Build a production-quality, server-authoritative LAN multiplayer backend for a 5–10 player social deduction game. The backend must own all game rules, hidden information, timers, transitions, persistence, reconnect behavior, and Socket.IO communication.

## Technical Foundation

- [ ] Initialize a NestJS + TypeScript application.
- [ ] Configure strict TypeScript, linting, formatting, environment validation, and structured logging.
- [ ] Add Prisma ORM with SQLite and enable WAL mode.
- [ ] Bind the HTTP and Socket.IO server to `0.0.0.0` for LAN access.
- [ ] Add health and readiness endpoints.
- [ ] Add Dockerfile and Docker Compose configuration.
- [ ] Define shared, versioned REST and Socket.IO payload contracts.
- [ ] Standardize success/error responses, error codes, request IDs, and acknowledgements.

## Persistence

- [ ] Model `GameRoom`, `Player`, `GameSession`, `GameRoleAssignment`, `GamePhase`, `GameTimer`, `GameQuest`, `TeamProposal`, `TeamVote`, `QuestSubmission`, `Assassination`, and `GameEvent`.
- [ ] Add UUID keys, timestamps, foreign keys, uniqueness constraints, state versioning, and rejoin-token hashes.
- [ ] Protect secret fields from public queries and logs.
- [ ] Use transactions for every sensitive state transition.
- [ ] Persist phase deadlines, pause state, remaining duration, and completed-game history.
- [ ] Resolve overdue timers safely after a server restart.

## Domain Game Engine

- [ ] Implement the engine as framework-independent modules with deterministic tests.
- [ ] Implement room and player lifecycle for 5–10 players.
- [ ] Implement validated role configuration and faction composition for every player count.
- [ ] Implement cryptographically safe role assignment.
- [ ] Implement accurate knowledge rules for Merlin, Percival, Morgana, Mordred, Oberon, Assassin, Loyal Servant, and Minion of Mordred.
- [ ] Implement deterministic leader rotation by seat order.
- [ ] Implement quest team sizes for 5–10 players.
- [ ] Implement the two-fail rule for quest four with 7–10 players.
- [ ] Implement strict-majority approval voting and tie rejection.
- [ ] Implement five consecutive rejected proposals as an Evil victory.
- [ ] Implement secret quest submissions and aggregate-only results.
- [ ] Implement three-success assassination flow and all victory conditions.
- [ ] Implement play-again while retaining the room and players.

## Authoritative State Machine

- [ ] Support `LOBBY`, `ROLE_REVEAL`, `OPENING_DISCUSSION`, `TEAM_SELECTION`, `TEAM_DISCUSSION`, `TEAM_VOTING`, `VOTE_RESULT`, `QUEST_SUBMISSION`, `QUEST_RESULT`, `ROUND_DISCUSSION`, `ASSASSINATION_DISCUSSION`, `ASSASSINATION_DECISION`, and `GAME_OVER`.
- [ ] Allow transitions only through validated commands or timer expiration.
- [ ] Authenticate player identity using opaque rejoin tokens; never trust client-supplied roles.
- [ ] Authorize every command by player, host privilege, and current phase.
- [ ] Make commands idempotent and reject stale state/phase versions.
- [ ] Persist each transition atomically with an audit-safe game event.

## Timer Engine

- [ ] Implement configurable Relaxed, Standard, Quick Match, and Custom presets.
- [ ] Support enabling/disabling timers per phase.
- [ ] Store `phaseStartedAt`, `phaseDeadlineAt`, `remainingDuration`, `pausedAt`, `timerStatus`, and `phaseVersion`.
- [ ] Implement pause, resume, add 30 seconds, and add 60 seconds with host authorization and extension limits.
- [ ] Reject actions after authoritative expiry.
- [ ] Apply documented timeout policies: random valid team, missing approval as Reject, missing quest submission as Success, and random eligible assassination target.
- [ ] Make timer expiration atomic, idempotent, restart-safe, and resilient to concurrent workers/events.

## REST, Socket.IO, and LAN Support

- [ ] Implement room creation, join, leave, ready, removal, configuration, and start commands.
- [ ] Implement typed client events for role acknowledgement, team proposal, approval vote, quest submission, assassination, timer controls, and sync.
- [ ] Implement typed server events for room updates, public/private snapshots, phases, timers, progress, results, reconnect, disconnect, and errors.
- [ ] Send per-player private snapshots without leaking other roles or quest submissions.
- [ ] Never reveal approval votes before voting closes.
- [ ] Add Socket.IO acknowledgement responses and duplicate-action protection.
- [ ] Detect the usable LAN address and expose room join information for QR generation.

## Reconnect and Recovery

- [ ] Issue and hash secure per-player rejoin tokens.
- [ ] Restore identity, current phase, submitted-action state, and timer state after refresh or reconnect.
- [ ] Mark online/offline state without exposing hidden information.
- [ ] Handle host disconnect without invalidating the game.
- [ ] Recover active sessions and resolve overdue phases after restart.

## Automated Verification

- [ ] Unit-test rules, role distribution, role knowledge, quest thresholds, voting, assassination, and victory logic.
- [ ] Unit-test all timer policies, pause/resume/extension, expiry races, and restart recovery.
- [ ] Test every valid and invalid state transition.
- [ ] Test secret-data filtering for every role and phase.
- [ ] Test duplicate and simultaneous submissions.
- [ ] Test reconnect, host disconnect, and state synchronization.
- [ ] Simulate complete games for player counts 5, 6, 7, 8, 9, and 10.
- [ ] Add integration tests for REST and Socket.IO flows.

## Delivery

- [ ] Provide `.env.example`, migrations, scripts, and deterministic test commands.
- [ ] Document LAN startup, Docker startup, database recovery, timeout policies, and API/event contracts.
- [ ] Verify a complete real multiplayer game can finish without manual state edits or server restart.

## Definition of Done

- All supported player counts complete a full game correctly.
- Secret roles and individual quest submissions never appear in unauthorized payloads or logs.
- Refresh, reconnect, retries, concurrent submissions, and server restart preserve valid state.
- Timers remain synchronized and cannot transition the game twice.
- Automated tests and production builds pass.

