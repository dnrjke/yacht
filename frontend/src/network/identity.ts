import { PlayerIdentity } from '@yacht/core';

export function getOrCreateIdentity(): PlayerIdentity {
  const stored = sessionStorage.getItem('yacht_identity');
  if (stored) return JSON.parse(stored);

  const backup = localStorage.getItem('yacht_reconnect');
  if (backup) {
    const parsed = JSON.parse(backup);
    return { playerId: parsed.playerId, secret: parsed.secret, playerName: parsed.playerName ?? '' };
  }

  const identity: PlayerIdentity = {
    playerId: crypto.randomUUID(),
    secret: crypto.randomUUID(),
    playerName: '',
  };
  sessionStorage.setItem('yacht_identity', JSON.stringify(identity));
  return identity;
}

export function saveIdentity(identity: PlayerIdentity): void {
  sessionStorage.setItem('yacht_identity', JSON.stringify(identity));
}

export function saveReconnectInfo(playerId: string, secret: string, roomId: string, playerName: string): void {
  localStorage.setItem('yacht_reconnect', JSON.stringify({ playerId, secret, roomId, playerName }));
}

export function clearReconnectInfo(): void {
  localStorage.removeItem('yacht_reconnect');
}

export function getReconnectInfo(): { playerId: string; secret: string; roomId: string } | null {
  const data = localStorage.getItem('yacht_reconnect');
  if (!data) return null;
  return JSON.parse(data);
}
