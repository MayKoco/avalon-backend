-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GameRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "hostPlayerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LOBBY',
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GameRoom" ("code", "createdAt", "hostPlayerId", "id", "stateVersion", "status", "updatedAt") SELECT "code", "createdAt", "hostPlayerId", "id", "stateVersion", "status", "updatedAt" FROM "GameRoom";
DROP TABLE "GameRoom";
ALTER TABLE "new_GameRoom" RENAME TO "GameRoom";
CREATE UNIQUE INDEX "GameRoom_code_key" ON "GameRoom"("code");
CREATE TABLE "new_Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "rejoinTokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Player_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Player" ("connected", "createdAt", "id", "nickname", "ready", "rejoinTokenHash", "roomId", "seat", "updatedAt") SELECT "connected", "createdAt", "id", "nickname", "ready", "rejoinTokenHash", "roomId", "seat", "updatedAt" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_rejoinTokenHash_key" ON "Player"("rejoinTokenHash");
CREATE UNIQUE INDEX "Player_roomId_seat_key" ON "Player"("roomId", "seat");
CREATE UNIQUE INDEX "Player_roomId_nickname_key" ON "Player"("roomId", "nickname");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
