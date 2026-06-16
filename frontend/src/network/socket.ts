import { io, Socket } from 'socket.io-client';
import { derivePlacementOrder, GameSnapshot } from '@yacht/core';
import { useGameStore } from '../store/gameStore';
import { emitPourResult, getPhysicsEngine } from '../physics/physicsEngine';
import { getReconnectInfo, clearReconnectInfo } from './identity';
import { pushShakeFrame, clearShakeBuffer } from './shakeBuffer';
import { applySpectatorPourBuffer } from './spectatorBuffer';
import { soundManager } from '../utils/soundManager';
import { pushDebugLog } from '../components/ui/DebugOverlay';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

interface ConnectSocketOptions {
  autoReconnect?: boolean;
}

export function connectSocket(options: ConnectSocketOptions = {}): Socket {
  const { autoReconnect = true } = options;
  if (socket?.connected) return socket;

  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    const s = useGameStore.getState();
    s.setIsConnected(true);

    const reconnect = getReconnectInfo();
    if (autoReconnect && reconnect) {
      socket!.emit('RECONNECT', reconnect);
    }
  });

  socket.on('disconnect', () => {
    useGameStore.getState().setIsConnected(false);
  });

  socket.on('RECONNECT_OK', ({ snapshot }: { snapshot: GameSnapshot }) => {
    pushDebugLog('RECONNECT_OK', { turn: snapshot.currentTurn, rollCount: snapshot.rollCount, turnPhase: snapshot.turnPhase, diceValues: snapshot.currentDiceValues });
    clearShakeBuffer();
    applySnapshot(snapshot);
    const s = useGameStore.getState();
    s.setGameMode('online');
    const reconnect = getReconnectInfo();
    if (reconnect) s.setRoomId(reconnect.roomId);
    s.setPhase(snapshot.phase === 'finished' ? 'GAME_OVER' : 'GAME');
  });

  socket.on('RECONNECT_FAIL', () => {
    clearReconnectInfo();
    const s = useGameStore.getState();
    if (s.phase !== 'ONLINE_LOBBY') {
      s.setPhase('MAIN_MENU');
    }
  });

  socket.on('POUR_RESULT', (result: any) => {
    clearShakeBuffer();
    pushDebugLog('POUR_RESULT', { finalValues: result.finalValues, rollCount: result.rollCount, frames: result.diceTrajectory?.length, serverSimMs: result.serverSimMs });
    const s = useGameStore.getState();
    if (s.gameMode === 'online') {
      if (!isCurrentTurnEvent(result.turnNumber)) return;
      s.setRollCount(result.rollCount);
      s.setOnlineContext(result.turnNumber, result.rollId);
    }
    const isSpectator = s.gameMode === 'online' && s.currentTurn !== s.myRole;
    const bufferedResult = isSpectator ? applySpectatorPourBuffer(result) : result;
    if (isSpectator) {
      pushDebugLog('SPECTATOR_POUR_BUFFER', {
        bufferMs: bufferedResult.spectatorBufferMs,
        frames: bufferedResult.diceTrajectory?.length,
        turnNumber: result.turnNumber,
        rollId: result.rollId,
      });
    }
    emitPourResult(bufferedResult);
  });

  socket.on('POUR_ACCEPTED', ({ turnNumber, rollId, rollCount }: { turnNumber?: number; rollId?: number; rollCount: number }) => {
    pushDebugLog('POUR_ACCEPTED', { turnNumber, rollId, rollCount });
    const s = useGameStore.getState();
    if (s.gameMode === 'online' && !isCurrentTurnEvent(turnNumber)) return;
    s.setRollCount(rollCount);
    if (s.gameMode === 'online' && typeof turnNumber === 'number' && typeof rollId === 'number') {
      s.setOnlineContext(turnNumber, rollId);
    }
  });

  socket.on('POUR_REJECTED', ({ reason }: { reason: string }) => {
    pushDebugLog('POUR_REJECTED', { reason });
    console.warn('Pour rejected:', reason);
    const s = useGameStore.getState();
    const physics = getPhysicsEngine();
    if (physics) {
      physics.resetCupToRest();
      physics.spawnNonKeptDiceInCup(s.keptDiceSlots);
    }
    s.setCanPour(true);
  });

  socket.on('KEPT_UPDATE', ({ turnNumber, rollId, keptDiceSlots }: { turnNumber?: number; rollId?: number; keptDiceSlots: (number | null)[] }) => {
    pushDebugLog('KEPT_UPDATE', { turnNumber, rollId, keptDiceSlots });
    const s = useGameStore.getState();
    if (s.gameMode === 'online' && !isCurrentTurnEvent(turnNumber)) return;
    if (s.gameMode === 'online' && typeof rollId === 'number') s.setOnlineContext(turnNumber ?? s.onlineTurnNumber, rollId);
    if (s.gameMode === 'online' && s.currentTurn !== s.myRole) {
      soundManager.play('tap', { volume: 0.4 });
    }
    s.setKeptDiceSlots(keptDiceSlots);
    s.setPlacementOrder(derivePlacementOrder(keptDiceSlots, s.currentDiceValues));
  });

  socket.on('COLLECT_TO_CUP', ({ turnNumber, rollId }: { turnNumber?: number; rollId?: number } = {}) => {
    pushDebugLog('COLLECT_TO_CUP', { turnNumber, rollId });
    const s = useGameStore.getState();
    if (s.gameMode === 'online' && !isCurrentTurnEvent(turnNumber)) return;
    if (s.gameMode === 'online' && typeof rollId === 'number') s.setOnlineContext(turnNumber ?? s.onlineTurnNumber, rollId);
    const isMyTurnNow = s.gameMode === 'online' && s.currentTurn === s.myRole;
    if (isMyTurnNow) return;

    soundManager.play('reroll', { volume: 0.5 });
    s.setIsInPlacementMode(false);
    s.setIsSyncingDice(true);
    s.setReturnReason('reroll');
    if (s.placementOrder.length > 0) {
      s.setIsReturningToCup(true);
    }
  });

  socket.on('CAN_POUR', ({ turnNumber, rollId }: { turnNumber?: number; rollId?: number } = {}) => {
    pushDebugLog('CAN_POUR', { turnNumber, rollId });
    const s = useGameStore.getState();
    if (s.gameMode === 'online' && !isCurrentTurnEvent(turnNumber)) return;
    if (s.gameMode === 'online' && typeof turnNumber === 'number' && typeof rollId === 'number') {
      s.setOnlineContext(turnNumber, rollId);
    }
    s.setCanPour(true);
  });

  socket.on('SCORE_CONFIRMED', ({ player, category, value, scores, nextTurn, turnNumber, rollId }: { player: string; category: string; value: number; scores: any; nextTurn: 'p1' | 'p2'; turnNumber?: number; rollId?: number }) => {
    pushDebugLog('SCORE_CONFIRMED', { player, category, value, nextTurn, turnNumber, rollId });
    const s = useGameStore.getState();
    if (s.gameMode === 'online' && isPastTurnEvent(turnNumber)) return;
    if (s.gameMode === 'online' && player !== s.myRole) {
      soundManager.play('score', { volume: 0.5 });
    }
    s.setScores(scores);
    s.setCurrentTurn(nextTurn);
    s.setRollCount(0);
    s.setKeptDiceSlots([null, null, null, null, null]);
    s.setPreviewScores({});
    s.setCanPour(false);
    s.setIsInPlacementMode(false);
    s.setActiveCombo(null);
    s.setPlacementOrder([0, 1, 2, 3, 4]);
    s.setReturnReason('turnEnd');
    s.setIsReturningToCup(true);
    s.setIsSyncingDice(true);
    if (s.gameMode === 'online' && typeof turnNumber === 'number' && typeof rollId === 'number') {
      s.setOnlineContext(turnNumber, rollId);
    }
  });

  socket.on('REROLL_REJECTED', () => {
    const s = useGameStore.getState();
    s.setIsReturningToCup(false);
    s.setIsSyncingDice(false);
    s.setReturnReason(null);
    s.setIsInPlacementMode(true);
  });

  socket.on('GAME_OVER', ({ scores }: { scores: any }) => {
    const s = useGameStore.getState();
    s.setScores(scores);
    s.setPhase('GAME_OVER');
  });

  socket.on('TURN_TIMER_SYNC', ({ remainingMs }: { remainingMs: number }) => {
    useGameStore.getState().setTurnTimerEnd(performance.now() + remainingMs);
  });

  socket.on('AUTO_PLAY_STARTED', ({ player }: { player: 'p1' | 'p2' }) => {
    useGameStore.getState().setAutoPlayActive(player);
  });

  socket.on('AUTO_PLAY_ENDED', () => {
    useGameStore.getState().setAutoPlayActive(null);
  });

  socket.on('OPPONENT_CONNECTION_QUALITY', ({ quality }: { quality: 'good' | 'unstable' | 'poor' }) => {
    useGameStore.getState().setOpponentConnectionQuality(quality);
  });

  socket.on('OPPONENT_DISCONNECTED', ({ gracePeriodMs }: { gracePeriodMs: number }) => {
    useGameStore.getState().setOpponentConnectionQuality('poor');
    console.log(`Opponent disconnected, grace period: ${gracePeriodMs}ms`);
  });

  socket.on('OPPONENT_RECONNECTED', () => {
    useGameStore.getState().setOpponentConnectionQuality('good');
    console.log('Opponent reconnected');
  });

  socket.on('OPPONENT_TIMEOUT', () => {
    const s = useGameStore.getState();
    s.setPhase('GAME_OVER');
  });

  socket.on('REMATCH_REQUESTED', () => {
    useGameStore.getState().setOpponentWantsRematch(true);
  });

  socket.on('REMATCH_START', () => {
    pushDebugLog('REMATCH_START', {});
    const s = useGameStore.getState();
    s.resetGame();
    s.setCanPour(false);
    s.setPhase('GAME');
  });

  socket.on('OPPONENT_SHAKE_STATE', (data: any) => {
    if (!isCurrentTurnEvent(data?.turnNumber)) return;
    pushShakeFrame(data);
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

function applySnapshot(snapshot: GameSnapshot): void {
  const s = useGameStore.getState();
  const diceValues = (snapshot.currentDiceValues as number[]).map(v => (
    Number.isInteger(v) && v >= 1 && v <= 6 ? v : 1
  ));
  s.setCurrentDiceValues(diceValues);
  s.setKeptDiceSlots(snapshot.keptDiceSlots);
  s.setCurrentTurn(snapshot.currentTurn);
  s.setRollCount(snapshot.rollCount);
  s.setOnlineContext(snapshot.turnNumber, snapshot.rollId);
  s.setScores(snapshot.scores);
  s.setCanPour(snapshot.canPour);
  s.setMyRole(snapshot.myRole);
  s.setOpponentName(snapshot.opponentName);

  s.setIsInPlacementMode(snapshot.turnPhase === 'placement');
  s.setIsReturningToCup(false);
  s.setIsSyncingDice(false);
  s.setReturnReason(null);

  if (snapshot.turnPhase === 'placement') {
    s.setPlacementOrder(derivePlacementOrder(snapshot.keptDiceSlots, diceValues));
  } else {
    s.setPlacementOrder([0, 1, 2, 3, 4]);
  }

  const physics = getPhysicsEngine();
  if (physics) {
    physics.currentDiceValues = diceValues;
    if (snapshot.turnPhase === 'waiting_pour' || snapshot.turnPhase === 'collecting') {
      physics.spawnNonKeptDiceInCup(snapshot.keptDiceSlots);
    }
  }

  s.setAutoPlayActive(snapshot.autoPlayActive);
}

function isCurrentTurnEvent(turnNumber?: number): boolean {
  const s = useGameStore.getState();
  return typeof turnNumber !== 'number' || turnNumber === s.onlineTurnNumber;
}

function isPastTurnEvent(turnNumber?: number): boolean {
  const s = useGameStore.getState();
  return typeof turnNumber === 'number' && turnNumber < s.onlineTurnNumber;
}
