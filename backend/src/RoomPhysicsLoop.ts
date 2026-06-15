import { Server } from 'socket.io';
import { Room } from './RoomManager';

type Role = 'p1' | 'p2';

interface ShakeInput {
  role: Role;
  turnNumber?: number;
  seq?: number;
  clientSentAt?: number;
  cupPosition: { x: number; y: number; z: number };
  cupQuaternion: { x: number; y: number; z: number; w: number };
}

const TICK_MS = 1000 / 60;

export class RoomPhysicsLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private latestInput: ShakeInput | null = null;
  private lastSeqByRole: Record<Role, number> = { p1: -1, p2: -1 };

  constructor(private room: Room, private io: Server) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  clearInput(): void {
    this.latestInput = null;
    this.lastSeqByRole = { p1: -1, p2: -1 };
  }

  enqueueShake(role: Role, data: Omit<ShakeInput, 'role'>): void {
    if (typeof data.seq === 'number' && data.seq <= this.lastSeqByRole[role]) return;
    if (typeof data.seq === 'number') this.lastSeqByRole[role] = data.seq;
    this.latestInput = { ...data, role };
  }

  flushLatest(): void {
    this.applyLatestInput();
    this.latestInput = null;
  }

  private tick(): void {
    if (this.room.state.turnPhase !== 'waiting_pour') return;
    this.applyLatestInput();
  }

  private applyLatestInput(): void {
    const input = this.latestInput;
    if (!input) return;
    if (this.room.state.currentTurn !== input.role) return;
    if (!this.room.state.validateTurnContext(input.turnNumber)) return;

    this.room.physics.updateCupTransform(input.cupPosition, input.cupQuaternion);
    this.room.physics.step();

    const opponent = this.room.players.find((_, index) => (
      input.role === 'p1' ? index === 1 : index === 0
    ));
    if (opponent?.socketId) {
      const cupState = this.room.physics.getCupState();
      this.io.to(opponent.socketId).emit('OPPONENT_SHAKE_STATE', {
        turnNumber: input.turnNumber,
        seq: input.seq,
        clientSentAt: input.clientSentAt,
        serverSentAt: Date.now(),
        cupPosition: cupState.position,
        cupQuaternion: cupState.quaternion,
        diceStates: this.room.physics.getDiceStates(),
      });
    }
  }
}
