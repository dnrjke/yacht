import { Server } from 'socket.io';
import { Room } from './RoomManager';

type Role = 'p1' | 'p2';

interface DiceState {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

interface ShakeInput {
  role: Role;
  turnNumber?: number;
  seq?: number;
  clientSentAt?: number;
  cupPosition: { x: number; y: number; z: number };
  cupQuaternion: { x: number; y: number; z: number; w: number };
  diceStates?: DiceState[];
}

const TICK_MS = 1000 / 60;

interface ShakeRelayMetrics {
  received: number;
  seqDropped: number;
  ticksNoInput: number;
  phaseSkipped: number;
  turnMismatch: number;
  contextFail: number;
  relayed: number;
  noOpponent: number;
}

export class RoomPhysicsLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private latestInput: ShakeInput | null = null;
  private lastSeqByRole: Record<Role, number> = { p1: -1, p2: -1 };
  private metrics: ShakeRelayMetrics = {
    received: 0, seqDropped: 0, ticksNoInput: 0,
    phaseSkipped: 0, turnMismatch: 0, contextFail: 0,
    relayed: 0, noOpponent: 0,
  };

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

  getAndResetMetrics(): ShakeRelayMetrics {
    const snap = { ...this.metrics };
    this.metrics = {
      received: 0, seqDropped: 0, ticksNoInput: 0,
      phaseSkipped: 0, turnMismatch: 0, contextFail: 0,
      relayed: 0, noOpponent: 0,
    };
    return snap;
  }

  enqueueShake(role: Role, data: Omit<ShakeInput, 'role'>): void {
    if (typeof data.seq === 'number' && data.seq <= this.lastSeqByRole[role]) {
      this.metrics.seqDropped++;
      return;
    }
    this.metrics.received++;
    if (typeof data.seq === 'number') this.lastSeqByRole[role] = data.seq;
    this.latestInput = { ...data, role };
  }

  flushLatest(): void {
    this.applyLatestInput();
    this.latestInput = null;
  }

  private tick(): void {
    if (this.room.state.turnPhase !== 'waiting_pour') {
      if (this.latestInput) this.metrics.phaseSkipped++;
      return;
    }
    this.applyLatestInput();
  }

  private applyLatestInput(): void {
    const input = this.latestInput;
    if (!input) {
      this.metrics.ticksNoInput++;
      return;
    }
    if (this.room.state.currentTurn !== input.role) {
      this.metrics.turnMismatch++;
      return;
    }
    if (!this.room.state.validateTurnContext(input.turnNumber)) {
      this.metrics.contextFail++;
      return;
    }

    const opponent = this.room.players.find((_, index) => (
      input.role === 'p1' ? index === 1 : index === 0
    ));
    if (opponent?.socketId) {
      this.metrics.relayed++;
      this.io.to(opponent.socketId).emit('OPPONENT_SHAKE_STATE', {
        turnNumber: input.turnNumber,
        seq: input.seq,
        clientSentAt: input.clientSentAt,
        serverSentAt: Date.now(),
        cupPosition: input.cupPosition,
        cupQuaternion: input.cupQuaternion,
        diceStates: input.diceStates,
      });
    } else {
      this.metrics.noOpponent++;
    }
    this.latestInput = null;
  }
}
