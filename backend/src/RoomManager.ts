import { PhysicsWorld } from './physics/PhysicsWorld';
import { ServerGameState } from './ServerGameState';

export interface PlayerSlot {
  playerId: string;
  secret: string;
  socketId: string | null;
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface Room {
  id: string;
  code: string;
  players: PlayerSlot[];
  physics: PhysicsWorld;
  state: ServerGameState;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  rematchFlags: { p1: boolean; p2: boolean };
}

const MAX_ACTIVE_ROOMS = 25;

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function generateCode(existingCodes: Set<string>): string {
  let code: string;
  do {
    code = Math.random().toString().slice(2, 8);
  } while (existingCodes.has(code));
  return code;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private codeToRoomId = new Map<string, string>();

  get size(): number {
    return this.rooms.size;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomByCode(code: string): Room | undefined {
    const roomId = this.codeToRoomId.get(code);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  findRoomByPlayerId(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.some(p => p.playerId === playerId)) return room;
    }
    return undefined;
  }

  async createRoom(playerName: string, playerId: string, secret: string, socketId: string): Promise<Room> {
    if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
      throw new Error('server_full');
    }

    const physics = await PhysicsWorld.create();
    const existingCodes = new Set(this.codeToRoomId.keys());
    const code = generateCode(existingCodes);
    const id = generateId();

    const room: Room = {
      id,
      code,
      players: [{
        playerId,
        secret,
        socketId,
        name: playerName,
        connected: true,
        disconnectedAt: null,
      }],
      physics,
      state: new ServerGameState(),
      disconnectTimer: null,
      rematchFlags: { p1: false, p2: false },
    };

    this.rooms.set(id, room);
    this.codeToRoomId.set(code, id);

    return room;
  }

  joinRoom(room: Room, playerName: string, playerId: string, secret: string, socketId: string): boolean {
    if (room.players.length >= 2) return false;

    room.players.push({
      playerId,
      secret,
      socketId,
      name: playerName,
      connected: true,
      disconnectedAt: null,
    });

    return true;
  }

  destroyRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.disconnectTimer) {
      clearTimeout(room.disconnectTimer);
    }

    room.physics.world.free();
    this.codeToRoomId.delete(room.code);
    this.rooms.delete(roomId);
  }

  getPlayerSlot(room: Room, playerId: string): PlayerSlot | undefined {
    return room.players.find(p => p.playerId === playerId);
  }

  getPlayerBySocketId(room: Room, socketId: string): PlayerSlot | undefined {
    return room.players.find(p => p.socketId === socketId);
  }

  getOpponent(room: Room, playerId: string): PlayerSlot | undefined {
    return room.players.find(p => p.playerId !== playerId);
  }

  getPlayerRole(room: Room, playerId: string): 'p1' | 'p2' | null {
    const idx = room.players.findIndex(p => p.playerId === playerId);
    if (idx === 0) return 'p1';
    if (idx === 1) return 'p2';
    return null;
  }
}
