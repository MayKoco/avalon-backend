# Shadows of Camelot — Backend Implementation Tasks

## Goal

Build a production-quality, server-authoritative LAN multiplayer backend for a 5–10 player social deduction game. The backend must own all game rules, hidden information, timers, transitions, persistence, reconnect behavior, and Socket.IO communication.

## Technical Foundation

- [x] Initialize a NestJS + TypeScript application.
- [x] Configure strict TypeScript compilation.
- [x] Add Prisma ORM with SQLite and enable WAL mode.
- [x] Bind the HTTP and Socket.IO server to `0.0.0.0` for LAN access.
- [ ] Add health and readiness endpoints.
- [x] Add Dockerfile and Docker Compose configuration.
- [x] Define typed REST and Socket.IO payload contracts.
- [x] Standardize success/error responses, error codes, request IDs, and acknowledgements.

## Persistence

- [x] Model `GameRoom`, `Player`, `GameSession`, `GameRoleAssignment`, `GamePhase`, `GameTimer`, `GameQuest`, `TeamProposal`, `TeamVote`, `QuestSubmission`, `Assassination`, and `GameEvent`.
- [x] Add UUID keys, timestamps, foreign keys, uniqueness constraints, state versioning, and rejoin-token hashes.
- [x] Protect secret fields from public snapshots and logs.
- [x] Use transactions and optimistic versions for sensitive state transitions.
- [x] Persist phase deadlines, pause state, remaining duration, and completed-game history.
- [x] Resolve overdue timers safely and immediately after a server restart.

## Domain Game Engine

- [x] Implement the engine as framework-independent modules with deterministic tests.
- [x] Implement room and player lifecycle for 5–10 players.
- [x] Implement validated role configuration and faction composition for every player count.
- [x] Implement randomized role assignment on the server.
- [x] Implement accurate knowledge rules for Merlin, Percival, Morgana, Mordred, Oberon, Assassin, Loyal Servant, and Minion of Mordred.
- [x] Implement deterministic leader rotation by seat order.
- [x] Implement quest team sizes for 5–10 players.
- [x] Implement the two-fail rule for quest four with 7–10 players.
- [x] Implement strict-majority approval voting and tie rejection.
- [x] Implement five consecutive rejected proposals as an Evil victory.
- [x] Implement secret quest submissions and aggregate-only results.
- [x] Implement three-success assassination flow and all victory conditions.
- [x] Implement play-again while retaining human players and completed-game history.

## Authoritative State Machine

- [x] Support `LOBBY`, `ROLE_REVEAL`, `OPENING_DISCUSSION`, `TEAM_SELECTION`, `TEAM_DISCUSSION`, `TEAM_VOTING`, `VOTE_RESULT`, `QUEST_SUBMISSION`, `QUEST_RESULT`, `ROUND_DISCUSSION`, `ASSASSINATION_DISCUSSION`, `ASSASSINATION_DECISION`, and `GAME_OVER`.
- [x] Allow transitions only through validated commands or timer expiration.
- [x] Authenticate player identity using opaque rejoin tokens; never trust client-supplied roles.
- [x] Authorize player, leader, assassin, host, and phase-specific commands.
- [x] Reject duplicate commands and stale state versions.
- [ ] Persist each transition atomically with an audit-safe game event.

## Timer Engine

- [ ] Implement configurable Relaxed, Standard, Quick Match, and Custom presets.
- [ ] Support enabling/disabling timers per phase.
- [x] Store `phaseStartedAt`, `phaseDeadlineAt`, `remainingDuration`, `pausedAt`, `timerStatus`, and `phaseVersion`.
- [x] Implement pause, resume, add 30 seconds, and add 60 seconds with host authorization and extension limits.
- [x] Apply documented timeout policies: random valid team, missing approval as Reject, missing quest submission as Success, and random eligible assassination target.
- [x] Make timer expiration optimistic, idempotent, and resilient to concurrent workers/events.

## REST, Socket.IO, and LAN Support

- [x] Implement room creation, join, leave, ready, host removal, and start commands.
- [ ] Implement pre-game role and timer configuration.
- [x] Implement typed client events for room lifecycle, role acknowledgement, team proposal, approval vote, quest submission, assassination, timer controls, play again, and sync.
- [ ] Implement typed server events for room updates, public/private snapshots, phases, timers, progress, results, reconnect, disconnect, and errors.
- [x] Send per-player private snapshots without leaking other roles or quest submissions.
- [x] Never reveal approval votes before voting closes.
- [x] Add Socket.IO acknowledgement responses and duplicate-action protection.
- [ ] Detect the usable LAN address and expose room join information for QR generation.

## Reconnect and Recovery

- [x] Issue and hash secure per-player rejoin tokens.
- [x] Restore identity, current phase, submitted-action state, and timer state after refresh or reconnect.
- [x] Mark online/offline state without exposing hidden information, including multiple sockets for one player.
- [x] Handle host disconnect without invalidating the game.
- [x] Recover active sessions and resolve overdue phases after restart.

## Automated Verification

- [x] Add an explicitly labeled host-only Test Mode that fills Bot seats to five and advances simulated actions without weakening normal-room validation.
- [x] Unit-test core rules, role distribution, role knowledge, quest thresholds, voting, and timeout transitions.
- [x] Unit-test all timer policies, pause/resume/extension, expiry races, and restart recovery.
- [ ] Test every valid and invalid state transition.
- [x] Test secret-data filtering for every role and phase.
- [x] Test duplicate and simultaneous submissions with real SQLite persistence for 5–10 players.
- [x] Test reconnect, host disconnect, and state synchronization.
- [x] Simulate complete Good/Evil games for player counts 5, 6, 7, 8, 9, and 10, including both assassination outcomes.
- [x] Add integration tests for REST and Socket.IO flows.

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

