import { Server } from 'socket.io';
import { Room } from './RoomManager';
import { GameActions } from './GameActions';
import { chooseAction, GAME_CONSTANTS, BOARD_CONSTANTS } from '@yacht/core';

export class ServerAutoPlay {
  private timers: NodeJS.Timeout[] = [];
  private active = false;
  private pendingResume = false;

  constructor(private room: Room, private gameActions: GameActions, private io: Server) {}

  start(): void {
    this.active = true;
    this.pendingResume = false;
    this.io.to(this.room.id).emit('AUTO_PLAY_STARTED', { player: this.room.state.currentTurn });
    this.executeNextStep();
  }

  stop(): void {
    this.active = false;
    this.pendingResume = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.io.to(this.room.id).emit('AUTO_PLAY_ENDED', { player: this.room.state.currentTurn });
  }

  get isActive(): boolean {
    return this.active;
  }

  requestResume(): void {
    const phase = this.room.state.turnPhase;
    if (phase === 'waiting_pour' || phase === 'placement') {
      this.stop();
    } else {
      this.pendingResume = true;
    }
  }

  private scheduleAfter(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter(t => t !== timer);
      fn();
    }, ms);
    this.timers.push(timer);
  }

  private executeNextStep(): void {
    if (!this.active) return;
    if (this.pendingResume) { this.stop(); return; }

    const state = this.room.state;
    const role = state.currentTurn;

    switch (state.turnPhase) {
      case 'waiting_pour':
        this.scheduleAfter(1000, () => {
          if (!this.active) return;
          const { CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;
          const pourPos = {
            x: (Math.random() - 0.5) * 6,
            y: CUP_REST_Y,
            z: (Math.random() - 0.5) * 4 - 1,
          };
          const pourQuat = { x: 0, y: 0, z: 0, w: 1 };
          this.gameActions.handleFromAutoPlay(role, 'POUR_CUP', { position: pourPos, quaternion: pourQuat });
          this.scheduleAfter(500, () => this.executeNextStep());
        });
        break;

      case 'placement':
        this.scheduleAfter(1500, () => {
          if (!this.active) return;
          const decision = chooseAction(
            state.currentDiceValues,
            state.scores[role] as any,
            GAME_CONSTANTS.MAX_ROLLS_PER_TURN - state.rollCount,
          );
          if (decision.action === 'score') {
            this.gameActions.handleFromAutoPlay(role, 'SUBMIT_SCORE', { category: decision.category });
          } else {
            this.executeKeepAndReroll(role, decision.keepIndices);
          }
        });
        break;

      case 'collecting':
        this.scheduleAfter(100, () => {
          if (!this.active) return;
          this.gameActions.handleCollectionDone(role);
          this.scheduleAfter(200, () => this.executeNextStep());
        });
        break;

      default:
        break;
    }
  }

  private executeKeepAndReroll(role: 'p1' | 'p2', keepIndices: number[]): void {
    if (!this.active) return;

    const currentKept = new Set(this.room.state.keptDiceSlots.filter((v): v is number => v !== null));
    const targetKept = new Set(keepIndices);

    for (const idx of currentKept) {
      if (!targetKept.has(idx)) {
        this.gameActions.handleFromAutoPlay(role, 'UNKEEP_DIE', { dieIndex: idx });
      }
    }
    for (const idx of targetKept) {
      if (!currentKept.has(idx)) {
        this.gameActions.handleFromAutoPlay(role, 'KEEP_DIE', { dieIndex: idx });
      }
    }

    this.scheduleAfter(500, () => {
      if (!this.active) return;
      this.gameActions.handleFromAutoPlay(role, 'REROLL', {});
      this.scheduleAfter(200, () => this.executeNextStep());
    });
  }
}
