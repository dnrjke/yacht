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

export interface ShakeRelayMetrics {
  received: number;
  seqDropped: number;
  phaseSkipped: number;
  turnMismatch: number;
  contextFail: number;
  relayed: number;
  noOpponent: number;
  arrivalTimeline: number[];
}

export class RoomPhysicsLoop {
  private lastSeqByRole: Record<Role, number> = { p1: -1, p2: -1 };
  private arrivalTimeline: number[] = [];
  private arrivalBase: number = 0;
  private metrics: ShakeRelayMetrics = {
    received: 0, seqDropped: 0,
    phaseSkipped: 0, turnMismatch: 0, contextFail: 0,
    relayed: 0, noOpponent: 0,
    arrivalTimeline: [],
  };

  constructor(private room: Room, private io: Server) {}

  start(): void {}
  stop(): void {}

  clearInput(): void {
    this.lastSeqByRole = { p1: -1, p2: -1 };
    this.arrivalTimeline = [];
    this.arrivalBase = 0;
  }

  getAndResetMetrics(): ShakeRelayMetrics {
    const snap = { ...this.metrics, arrivalTimeline: [...this.arrivalTimeline] };
    this.metrics = {
      received: 0, seqDropped: 0,
      phaseSkipped: 0, turnMismatch: 0, contextFail: 0,
      relayed: 0, noOpponent: 0,
      arrivalTimeline: [],
    };
    this.arrivalTimeline = [];
    this.arrivalBase = 0;
    return snap;
  }

  enqueueShake(role: Role, data: Omit<ShakeInput, 'role'>): void {
    if (typeof data.seq === 'number' && data.seq <= this.lastSeqByRole[role]) {
      this.metrics.seqDropped++;
      return;
    }
    this.metrics.received++;
    if (typeof data.seq === 'number') this.lastSeqByRole[role] = data.seq;

    if (this.room.state.turnPhase !== 'waiting_pour') {
      this.metrics.phaseSkipped++;
      return;
    }
    if (this.room.state.currentTurn !== role) {
      this.metrics.turnMismatch++;
      return;
    }
    if (!this.room.state.validateTurnContext(data.turnNumber)) {
      this.metrics.contextFail++;
      return;
    }

    const opponent = this.room.players.find((_, index) => (
      role === 'p1' ? index === 1 : index === 0
    ));
    if (opponent?.socketId) {
      this.metrics.relayed++;
      if (this.arrivalTimeline.length === 0) this.arrivalBase = Date.now();
      if (this.arrivalTimeline.length < 300) {
        this.arrivalTimeline.push(Date.now() - this.arrivalBase);
      }
      this.io.to(opponent.socketId).emit('OPPONENT_SHAKE_STATE', {
        turnNumber: data.turnNumber,
        seq: data.seq,
        clientSentAt: data.clientSentAt,
        serverSentAt: Date.now(),
        cupPosition: data.cupPosition,
        cupQuaternion: data.cupQuaternion,
        diceStates: data.diceStates,
      });
    } else {
      this.metrics.noOpponent++;
    }
  }

  flushLatest(): void {}
}
