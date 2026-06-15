import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { BOARD_CONSTANTS, ConnectionQuality } from '@yacht/core';
import { RoomManager, Room, PlayerSlot } from './RoomManager';
import { GameActions } from './GameActions';
import { ServerAutoPlay } from './ServerAutoPlay';

dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 5000,
  pingTimeout: 5000,
});

const PORT = process.env.PORT || 3001;
const GRACE_PERIOD_MS = 30_000;

const roomManager = new RoomManager();
const roomActionsMap = new Map<string, GameActions>();
const roomAutoPlayMap = new Map<string, ServerAutoPlay>();
const IDLE_ROOM_TIMEOUT_MS = 5 * 60 * 1000;

// Rate limiting per socket
const socketRateMap = new Map<string, { game: number[]; shake: number[] }>();
const GAME_EVENT_LIMIT = { maxPerSecond: 10, windowMs: 1000 };
const SHAKE_EVENT_LIMIT = { maxPerSecond: 35, windowMs: 1000 };

function checkRateLimit(socketId: string, type: 'game' | 'shake'): boolean {
  const now = Date.now();
  const entry = socketRateMap.get(socketId) ?? { game: [], shake: [] };
  const limit = type === 'shake' ? SHAKE_EVENT_LIMIT : GAME_EVENT_LIMIT;
  const history = entry[type];
  const recent = history.filter(t => now - t < limit.windowMs);
  if (recent.length >= limit.maxPerSecond) return false;
  recent.push(now);
  entry[type] = recent;
  socketRateMap.set(socketId, entry);
  return true;
}

// Connection quality tracking per socket
const socketQualityMap = new Map<string, { pings: number[]; lastQuality: ConnectionQuality }>();
const MAX_PING_SAMPLES = 3;

function assessQuality(pings: number[]): ConnectionQuality {
  if (pings.length === 0) return 'poor';
  const avg = pings.reduce((a, b) => a + b, 0) / pings.length;
  if (avg > 500) return 'poor';
  if (avg > 200) return 'unstable';
  return 'good';
}

function trackPing(socket: Socket, rttMs: number): void {
  const roomId = (socket as any)._roomId as string | undefined;
  if (!roomId) return;

  const entry = socketQualityMap.get(socket.id) ?? { pings: [], lastQuality: 'good' as ConnectionQuality };
  entry.pings.push(rttMs);
  if (entry.pings.length > MAX_PING_SAMPLES) entry.pings.shift();
  socketQualityMap.set(socket.id, entry);

  const quality = assessQuality(entry.pings);
  if (quality !== entry.lastQuality) {
    entry.lastQuality = quality;
    const room = roomManager.getRoom(roomId);
    if (room) {
      const slot = room.players.find(p => p.socketId === socket.id);
      if (slot) {
        const opponent = roomManager.getOpponent(room, slot.playerId);
        if (opponent?.socketId) {
          io.to(opponent.socketId).emit('OPPONENT_CONNECTION_QUALITY', { quality });
        }
      }
    }
  }
}

function validateShakeState(data: any): boolean {
  if (!data || !data.cupPosition || !data.diceStates) return false;
  const { BOARD_SIZE } = BOARD_CONSTANTS;
  const bound = BOARD_SIZE / 2 + 5;
  if (Math.abs(data.cupPosition.x) > bound) return false;
  if (Math.abs(data.cupPosition.z) > bound) return false;
  if (data.cupPosition.y < 0 || data.cupPosition.y > 30) return false;
  if (!Array.isArray(data.diceStates) || data.diceStates.length !== 5) return false;
  return true;
}

const BOUND_EVENTS = [
  'CUP_SHAKE_STATE', 'POUR_CUP', 'KEEP_DIE', 'UNKEEP_DIE',
  'REROLL', 'COLLECTION_DONE', 'SUBMIT_SCORE', 'REQUEST_REMATCH',
  'RESUME_CONTROL', 'disconnect',
];

function tryResumeAutoPlay(room: Room): void {
  const ap = roomAutoPlayMap.get(room.id);
  if (ap?.isActive) ap.requestResume();
}

function resetTurnTimerForPlayer(room: Room, role: 'p1' | 'p2'): void {
  if (room.state.currentTurn !== role) return;
  if (room.state.finished) return;
  const ap = roomAutoPlayMap.get(room.id);
  if (ap?.isActive) return;
  room.state.resetTurnTimer();
  io.to(room.id).emit('TURN_TIMER_SYNC', { remainingMs: room.state.getRemainingMs() });
}

function cleanupRoom(roomId: string): void {
  const ap = roomAutoPlayMap.get(roomId);
  if (ap?.isActive) ap.stop();
  roomAutoPlayMap.delete(roomId);
  roomActionsMap.delete(roomId);
  roomManager.destroyRoom(roomId);
}

function unbindGameEvents(socket: Socket): void {
  for (const event of BOUND_EVENTS) {
    socket.removeAllListeners(event);
  }
}

function bindGameEvents(socket: Socket, room: Room, slot: PlayerSlot): void {
  unbindGameEvents(socket);

  const role = roomManager.getPlayerRole(room, slot.playerId)!;
  (socket as any)._roomId = room.id;

  const gameActions = roomActionsMap.get(room.id)!;

  socket.on('CUP_SHAKE_STATE', (data: any) => {
    if (!checkRateLimit(socket.id, 'shake')) return;
    if (!room.state.isEventAllowed('CUP_SHAKE_STATE')) return;
    if (room.state.currentTurn !== role) return;
    if (!validateShakeState(data)) return;

    const opponent = roomManager.getOpponent(room, slot.playerId);
    if (opponent?.socketId) {
      io.to(opponent.socketId).emit('OPPONENT_SHAKE_STATE', data);
    }
  });

  socket.on('POUR_CUP', (data: any) => {
    if (!checkRateLimit(socket.id, 'game')) return;
    tryResumeAutoPlay(room);
    gameActions.handleFromSocket(role, 'POUR_CUP', data, socket);
    resetTurnTimerForPlayer(room, role);
  });

  socket.on('KEEP_DIE', (data: any) => {
    if (!checkRateLimit(socket.id, 'game')) return;
    tryResumeAutoPlay(room);
    gameActions.handleFromSocket(role, 'KEEP_DIE', data, socket);
    resetTurnTimerForPlayer(room, role);
  });

  socket.on('UNKEEP_DIE', (data: any) => {
    if (!checkRateLimit(socket.id, 'game')) return;
    tryResumeAutoPlay(room);
    gameActions.handleFromSocket(role, 'UNKEEP_DIE', data, socket);
    resetTurnTimerForPlayer(room, role);
  });

  socket.on('REROLL', () => {
    if (!checkRateLimit(socket.id, 'game')) return;
    tryResumeAutoPlay(room);
    gameActions.handleFromSocket(role, 'REROLL', {}, socket);
    resetTurnTimerForPlayer(room, role);
  });

  socket.on('COLLECTION_DONE', () => {
    if (!checkRateLimit(socket.id, 'game')) return;
    gameActions.handleFromSocket(role, 'COLLECTION_DONE', {}, socket);
    resetTurnTimerForPlayer(room, role);
  });

  socket.on('SUBMIT_SCORE', (data: any) => {
    if (!checkRateLimit(socket.id, 'game')) return;
    tryResumeAutoPlay(room);
    gameActions.handleFromSocket(role, 'SUBMIT_SCORE', data, socket);
    resetTurnTimerForPlayer(room, role);
  });

  socket.on('RESUME_CONTROL', () => {
    if (room.state.currentTurn !== role) return;
    tryResumeAutoPlay(room);
  });

  socket.on('REQUEST_REMATCH', () => {
    if (room.state.finished !== true) return;
    const roleKey = role as 'p1' | 'p2';
    room.rematchFlags[roleKey] = true;

    if (room.rematchFlags.p1 && room.rematchFlags.p2) {
      const ap = roomAutoPlayMap.get(room.id);
      if (ap?.isActive) ap.stop();
      room.state.reset();
      room.physics.spawnDiceInCup();
      room.rematchFlags = { p1: false, p2: false };
      io.to(room.id).emit('REMATCH_START');
      io.to(room.id).emit('CAN_POUR');
      room.state.startTurnTimer();
      io.to(room.id).emit('TURN_TIMER_SYNC', { remainingMs: room.state.getRemainingMs() });
    } else {
      const opponent = roomManager.getOpponent(room, slot.playerId);
      if (opponent?.socketId) {
        io.to(opponent.socketId).emit('REMATCH_REQUESTED');
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id} (${slot.name})`);
    socketRateMap.delete(socket.id);
    socketQualityMap.delete(socket.id);

    slot.socketId = null;
    slot.connected = false;
    slot.disconnectedAt = Date.now();

    if (room.state.currentTurn === role && !room.state.finished) {
      const ap = roomAutoPlayMap.get(room.id);
      if (!ap?.isActive) {
        room.state.freezeTurnTimer();
      }
    }

    const opponent = roomManager.getOpponent(room, slot.playerId);
    if (opponent?.socketId) {
      io.to(opponent.socketId).emit('OPPONENT_DISCONNECTED', {
        gracePeriodMs: GRACE_PERIOD_MS,
      });
    }

    room.disconnectTimer = setTimeout(() => {
      if (!slot.connected) {
        if (opponent?.socketId && opponent.connected) {
          io.to(opponent.socketId).emit('OPPONENT_TIMEOUT');
        }
        cleanupRoom(room.id);
        console.log(`Room ${room.id} destroyed (disconnect timeout)`);
      }
    }, GRACE_PERIOD_MS);
  });
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  let lastPingSent = 0;
  socket.conn.on('ping', () => { lastPingSent = Date.now(); });
  socket.conn.on('pong', () => {
    if (lastPingSent > 0) {
      trackPing(socket, Date.now() - lastPingSent);
    }
  });

  socket.on('CREATE_ROOM', async (data: { playerName: string; playerId: string; secret: string }) => {
    try {
      const room = await roomManager.createRoom(data.playerName, data.playerId, data.secret, socket.id);
      socket.join(room.id);
      (socket as any)._roomId = room.id;

      room.idleTimer = setTimeout(() => {
        if (room.players.length < 2) {
          if (room.players[0]?.socketId) {
            io.to(room.players[0].socketId).emit('JOIN_ERROR', { reason: 'idle_timeout' });
          }
          cleanupRoom(room.id);
          console.log(`Room ${room.id} destroyed (idle timeout)`);
        }
      }, IDLE_ROOM_TIMEOUT_MS);

      socket.emit('ROOM_CREATED', { roomId: room.id, code: room.code });
      console.log(`Room created: ${room.id} (code: ${room.code}) by ${data.playerName}`);
    } catch (e: any) {
      socket.emit('JOIN_ERROR', { reason: e.message });
    }
  });

  socket.on('JOIN_ROOM', (data: { code: string; playerName: string; playerId: string; secret: string }) => {
    const room = roomManager.getRoomByCode(data.code);
    if (!room) {
      socket.emit('JOIN_ERROR', { reason: 'invalid_code' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('JOIN_ERROR', { reason: 'room_full' });
      return;
    }

    const joined = roomManager.joinRoom(room, data.playerName, data.playerId, data.secret, socket.id);
    if (!joined) {
      socket.emit('JOIN_ERROR', { reason: 'join_failed' });
      return;
    }

    socket.join(room.id);

    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }

    const gameActions = new GameActions(room, io);
    roomActionsMap.set(room.id, gameActions);

    const autoPlay = new ServerAutoPlay(room, gameActions, io);
    roomAutoPlayMap.set(room.id, autoPlay);

    room.state.onTurnTimeout = () => {
      if (room.state.finished) return;
      autoPlay.start();
    };

    gameActions.onTurnAdvanced = () => {
      if (autoPlay.isActive) autoPlay.stop();
      room.state.resetTurnTimer();
      io.to(room.id).emit('TURN_TIMER_SYNC', { remainingMs: room.state.getRemainingMs() });
    };

    gameActions.onGameFinished = () => {
      room.state.clearTurnTimer();
      if (autoPlay.isActive) autoPlay.stop();
    };

    room.physics.spawnDiceInCup();
    room.state.canPour = true;

    const p1 = room.players[0];
    const p2 = room.players[1];

    if (p1.socketId) {
      io.to(p1.socketId).emit('GAME_START', {
        roomId: room.id,
        players: [{ name: p1.name }, { name: p2.name }],
        yourRole: 'p1',
      });
    }
    if (p2.socketId) {
      io.to(p2.socketId).emit('GAME_START', {
        roomId: room.id,
        players: [{ name: p1.name }, { name: p2.name }],
        yourRole: 'p2',
      });
    }

    const p1Socket = p1.socketId ? io.sockets.sockets.get(p1.socketId) : null;
    const p2Socket = p2.socketId ? io.sockets.sockets.get(p2.socketId) : null;
    if (p1Socket) bindGameEvents(p1Socket, room, p1);
    if (p2Socket) bindGameEvents(p2Socket, room, p2);

    io.to(room.id).emit('CAN_POUR');

    room.state.startTurnTimer();
    io.to(room.id).emit('TURN_TIMER_SYNC', { remainingMs: room.state.getRemainingMs() });

    console.log(`Player ${data.playerName} joined room ${room.id}`);
  });

  socket.on('RECONNECT', (data: { playerId: string; secret: string; roomId: string }) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) {
      socket.emit('RECONNECT_FAIL', { reason: 'room_gone' });
      return;
    }

    const slot = roomManager.getPlayerSlot(room, data.playerId);
    if (!slot || slot.secret !== data.secret) {
      socket.emit('RECONNECT_FAIL', { reason: 'auth_failed' });
      return;
    }

    slot.socketId = socket.id;
    slot.connected = true;
    slot.disconnectedAt = null;
    socket.join(room.id);

    if (room.disconnectTimer) {
      clearTimeout(room.disconnectTimer);
      room.disconnectTimer = null;
    }

    const playerIdx = room.players.indexOf(slot);
    const opponent = roomManager.getOpponent(room, data.playerId);
    const ap = roomAutoPlayMap.get(room.id);
    const autoPlayPlayer = ap?.isActive ? room.state.currentTurn : null;
    const snapshot = room.state.buildSnapshot(
      data.playerId,
      playerIdx,
      opponent?.name ?? '',
      opponent?.connected ?? false,
      autoPlayPlayer,
    );

    socket.emit('RECONNECT_OK', { snapshot });

    if (opponent?.socketId) {
      io.to(opponent.socketId).emit('OPPONENT_RECONNECTED');
    }

    const reconnectRole = roomManager.getPlayerRole(room, data.playerId);
    if (!room.state.finished) {
      const remainingMs = room.state.getRemainingMs();
      if (remainingMs > 0) {
        socket.emit('TURN_TIMER_SYNC', { remainingMs });
      }

      if (reconnectRole && room.state.currentTurn === reconnectRole) {
        const ap = roomAutoPlayMap.get(room.id);
        if (ap?.isActive) {
          ap.requestResume();
        } else {
          room.state.resumeTurnTimer();
          socket.emit('TURN_TIMER_SYNC', { remainingMs: room.state.getRemainingMs() });
        }
      }
    }

    bindGameEvents(socket, room, slot);
    console.log(`Player ${slot.name} reconnected to room ${room.id}`);
  });
});

app.get('/health', (_req, res) => {
  res.send('Yacht Dice Backend is running!');
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
