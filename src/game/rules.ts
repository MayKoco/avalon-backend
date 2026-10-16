import { Assignment, Faction, Role } from './types';

export const FACTION_COUNTS: Record<number, { good: number; evil: number }> = {
  5: { good: 3, evil: 2 }, 6: { good: 4, evil: 2 }, 7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 }, 9: { good: 6, evil: 3 }, 10: { good: 6, evil: 4 },
};

export const QUEST_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5],
};

export function factionForRole(role: Role): Faction {
  return ['MERLIN', 'PERCIVAL', 'LOYAL_SERVANT'].includes(role) ? 'GOOD' : 'EVIL';
}

export function defaultRoles(playerCount: number): Role[] {
  const counts = FACTION_COUNTS[playerCount];
  if (!counts) throw new Error('PLAYER_COUNT_OUT_OF_RANGE');
  const roles: Role[] = ['MERLIN', 'ASSASSIN'];
  if (playerCount >= 6) roles.push('PERCIVAL', 'MORGANA');
  while (roles.filter((role) => factionForRole(role) === 'GOOD').length < counts.good) roles.push('LOYAL_SERVANT');
  while (roles.filter((role) => factionForRole(role) === 'EVIL').length < counts.evil) roles.push('MINION_OF_MORDRED');
  return roles;
}

export function validateRoles(playerCount: number, roles: Role[]): void {
  const counts = FACTION_COUNTS[playerCount];
  if (!counts || roles.length !== playerCount) throw new Error('INVALID_ROLE_CONFIGURATION');
  if (roles.filter((role) => role === 'MERLIN').length !== 1 || roles.filter((role) => role === 'ASSASSIN').length !== 1) throw new Error('REQUIRED_ROLE_MISSING');
  if (roles.filter((role) => factionForRole(role) === 'GOOD').length !== counts.good) throw new Error('INVALID_GOOD_COUNT');
  if (roles.filter((role) => factionForRole(role) === 'EVIL').length !== counts.evil) throw new Error('INVALID_EVIL_COUNT');
}

export function shuffle<T>(values: readonly T[], random = Math.random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function assignRoles(playerIds: string[], roles = defaultRoles(playerIds.length), random = Math.random): Assignment[] {
  validateRoles(playerIds.length, roles);
  const randomized = shuffle(roles, random);
  return playerIds.map((playerId, index) => ({ playerId, role: randomized[index], faction: factionForRole(randomized[index]) }));
}

export function questFailThreshold(playerCount: number, questIndex: number): number {
  return playerCount >= 7 && questIndex === 3 ? 2 : 1;
}

export function roleKnowledge(viewer: Assignment, assignments: Assignment[]): { playerId: string; appearsAs: string }[] {
  if (viewer.role === 'MERLIN') {
    return assignments.filter((item) => item.faction === 'EVIL' && item.role !== 'MORDRED').map((item) => ({ playerId: item.playerId, appearsAs: 'EVIL' }));
  }
  if (viewer.role === 'PERCIVAL') {
    return assignments.filter((item) => item.role === 'MERLIN' || item.role === 'MORGANA').map((item) => ({ playerId: item.playerId, appearsAs: 'MERLIN_OR_MORGANA' }));
  }
  if (viewer.faction === 'EVIL' && viewer.role !== 'OBERON') {
    return assignments.filter((item) => item.faction === 'EVIL' && item.role !== 'OBERON' && item.playerId !== viewer.playerId).map((item) => ({ playerId: item.playerId, appearsAs: 'EVIL_ALLY' }));
  }
  return [];
}
