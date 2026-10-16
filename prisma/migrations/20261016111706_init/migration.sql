-- CreateTable
CREATE TABLE "GameRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "hostPlayerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LOBBY',
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "rejoinTokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Player_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "phase" TEXT NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "leaderSeat" INTEGER NOT NULL,
    "questIndex" INTEGER NOT NULL DEFAULT 0,
    "rejectionCount" INTEGER NOT NULL DEFAULT 0,
    "goodScore" INTEGER NOT NULL DEFAULT 0,
    "evilScore" INTEGER NOT NULL DEFAULT 0,
    "winner" TEXT,
    "stateJson" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "GameSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameRoleAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "faction" TEXT NOT NULL,
    CONSTRAINT "GameRoleAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameRoleAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GamePhase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "GamePhase_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameTimer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "phaseVersion" INTEGER NOT NULL,
    "phaseStartedAt" DATETIME NOT NULL,
    "phaseDeadlineAt" DATETIME,
    "remainingDuration" INTEGER,
    "pausedAt" DATETIME,
    "timerStatus" TEXT NOT NULL,
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "GameTimer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameQuest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "questIndex" INTEGER NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "failThreshold" INTEGER NOT NULL,
    "result" TEXT,
    "successCount" INTEGER,
    "failCount" INTEGER,
    CONSTRAINT "GameQuest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "memberIdsJson" TEXT NOT NULL,
    "timeoutCreated" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamProposal_questId_fkey" FOREIGN KEY ("questId") REFERENCES "GameQuest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamProposal_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "approve" BOOLEAN NOT NULL,
    "timeoutCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamVote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TeamProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamVote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "timeoutCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestSubmission_questId_fkey" FOREIGN KEY ("questId") REFERENCES "GameQuest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestSubmission_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assassination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "assassinId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "hitMerlin" BOOLEAN NOT NULL,
    "timeoutCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Assassination_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assassination_assassinId_fkey" FOREIGN KEY ("assassinId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assassination_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "sessionId" TEXT,
    "type" TEXT NOT NULL,
    "stateVersion" INTEGER NOT NULL,
    "publicJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GameRoom_code_key" ON "GameRoom"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Player_rejoinTokenHash_key" ON "Player"("rejoinTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Player_roomId_seat_key" ON "Player"("roomId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "Player_roomId_nickname_key" ON "Player"("roomId", "nickname");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_roomId_sequence_key" ON "GameSession"("roomId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "GameRoleAssignment_sessionId_playerId_key" ON "GameRoleAssignment"("sessionId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePhase_sessionId_version_key" ON "GamePhase"("sessionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GameTimer_sessionId_phaseVersion_key" ON "GameTimer"("sessionId", "phaseVersion");

-- CreateIndex
CREATE UNIQUE INDEX "GameQuest_sessionId_questIndex_key" ON "GameQuest"("sessionId", "questIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TeamProposal_sessionId_questId_attempt_key" ON "TeamProposal"("sessionId", "questId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamVote_proposalId_playerId_key" ON "TeamVote"("proposalId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestSubmission_questId_playerId_key" ON "QuestSubmission"("questId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Assassination_sessionId_key" ON "Assassination"("sessionId");

-- CreateIndex
CREATE INDEX "GameEvent_roomId_stateVersion_idx" ON "GameEvent"("roomId", "stateVersion");
