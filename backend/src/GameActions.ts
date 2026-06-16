import { Server, Socket } from 'socket.io';
import { Room } from './RoomManager';
import { PourResult } from './physics/PhysicsWorld';

const MAX_TRAJECTORY_FRAMES = 1200;

function isFrame(frame: any): boolean {
  return Array.isArray(frame) && frame.length === 5;
}

// Validate a turn player's self-reported pour result. Anti-cheat (verifying the
// dice physically *could* land this way) is intentionally out of scope — this is
// a light structural/sanity gate only.
function extractClientPourResult(data: any): PourResult | null {
  if (!data) return null;
  const { finalValues, diceTrajectory, cupTrajectory } = data;

  if (!Array.isArray(finalValues) || finalValues.length !== 5) return null;
  if (!finalValues.every((v: any) => Number.isInteger(v) && v >= 1 && v <= 6)) return null;

  if (!Array.isArray(diceTrajectory) || diceTrajectory.length === 0) return null;
  if (diceTrajectory.length > MAX_TRAJECTORY_FRAMES) return null;
  if (!isFrame(diceTrajectory[0]) || !isFrame(diceTrajectory[diceTrajectory.length - 1])) return null;

  if (!Array.isArray(cupTrajectory) || cupTrajectory.length === 0) return null;
  if (cupTrajectory.length > MAX_TRAJECTORY_FRAMES) return null;

  return { diceTrajectory, cupTrajectory, finalValues };
}

export class GameActions {
  onTurnAdvanced: (() => void) | null = null;
  onGameFinished: (() => void) | null = null;
  beforePour: (() => void) | null = null;

  constructor(private room: Room, private io: Server) {}

  handleFromSocket(playerRole: 'p1' | 'p2', event: string, data: any, socket: Socket): void {
    this.execute(playerRole, event, data, socket);
  }

  handleFromAutoPlay(playerRole: 'p1' | 'p2', event: string, data: any): void {
    this.execute(playerRole, event, data, null);
  }

  private execute(playerRole: 'p1' | 'p2', event: string, data: any, socket: Socket | null): void {
    const state = this.room.state;
    if (state.currentTurn !== playerRole) {
      this.rejectPourIfNeeded(event, socket, 'not_your_turn');
      return;
    }
    if (!state.isEventAllowed(event)) {
      this.rejectPourIfNeeded(event, socket, 'wrong_phase');
      return;
    }
    if (!state.validateTurnContext(data?.turnNumber)) {
      this.rejectPourIfNeeded(event, socket, 'stale_turn');
      return;
    }

    switch (event) {
      case 'POUR_CUP':
        this.handlePour(playerRole, data, socket);
        break;
      case 'KEEP_DIE':
        this.handleKeep(playerRole, data.dieIndex);
        break;
      case 'UNKEEP_DIE':
        this.handleUnkeep(playerRole, data.dieIndex);
        break;
      case 'REROLL':
        this.handleReroll(playerRole, socket);
        break;
      case 'SUBMIT_SCORE':
        this.handleSubmitScore(playerRole, data.category);
        break;
      case 'COLLECTION_DONE':
        this.handleCollectionDone(playerRole);
        break;
    }
  }

  private rejectPourIfNeeded(event: string, socket: Socket | null, reason: string): void {
    if (event === 'POUR_CUP') {
      socket?.emit('POUR_REJECTED', { reason });
    }
  }

  private handlePour(playerRole: 'p1' | 'p2', data: any, socket: Socket | null): void {
    const state = this.room.state;
    const err = state.validatePour(playerRole);
    if (err) {
      socket?.emit('POUR_REJECTED', { reason: err });
      return;
    }

    state.turnPhase = 'simulating';
    state.isSimulating = true;
    state.canPour = false;
    const rollId = state.beginRoll();
    const serverStartedAt = Date.now();

    this.beforePour?.();

    // Client-authoritative motion: a human turn player simulates the pour
    // locally (what they actually see) and ships the result. The server only
    // sanity-checks it, records the value, and relays the trajectory to the
    // spectator so both screens show the identical motion. Auto-play (socket
    // === null) and malformed/absent client results fall back to a server
    // simulation broadcast to the whole room.
    const clientResult = socket ? extractClientPourResult(data) : null;

    let result: PourResult;
    let serverSimMs = 0;
    if (clientResult) {
      result = clientResult;
    } else {
      this.room.physics.reconcileDiceInCupPositions();
      const simStartedAt = Date.now();
      result = this.room.physics.simulatePour(data.position, data.quaternion);
      serverSimMs = Date.now() - simStartedAt;
    }

    state.rollCount++;
    state.currentDiceValues = result.finalValues;
    state.isSimulating = false;
    state.turnPhase = 'placement';

    const payload = {
      ...result,
      turnNumber: state.turnNumber,
      rollId,
      rollCount: state.rollCount,
      serverStartedAt,
      serverSimMs,
    };

    if (clientResult) {
      // Roller already played this locally — relay the trajectory to the
      // spectator only, and send the roller a lightweight ack so it picks up
      // the authoritative rollCount/rollId without re-playing the motion.
      const opponent = this.room.players.find((_, index) => (
        playerRole === 'p1' ? index === 1 : index === 0
      ));
      if (opponent?.socketId) {
        this.io.to(opponent.socketId).emit('POUR_RESULT', payload);
      }
      socket?.emit('POUR_ACCEPTED', {
        turnNumber: state.turnNumber,
        rollId,
        rollCount: state.rollCount,
      });
    } else {
      this.io.to(this.room.id).emit('POUR_RESULT', payload);
    }
  }

  private handleKeep(playerRole: 'p1' | 'p2', dieIndex: number): void {
    if (!this.room.state.validateKeep(playerRole, dieIndex)) return;
    if (this.room.state.keptDiceSlots.includes(dieIndex)) return;
    this.room.state.applyKeep(dieIndex);
    this.io.to(this.room.id).emit('KEPT_UPDATE', {
      turnNumber: this.room.state.turnNumber,
      rollId: this.room.state.rollId,
      keptDiceSlots: this.room.state.keptDiceSlots,
    });
  }

  private handleUnkeep(playerRole: 'p1' | 'p2', dieIndex: number): void {
    if (!this.room.state.validateKeep(playerRole, dieIndex)) return;
    if (!this.room.state.keptDiceSlots.includes(dieIndex)) return;
    this.room.state.applyUnkeep(dieIndex);
    this.io.to(this.room.id).emit('KEPT_UPDATE', {
      turnNumber: this.room.state.turnNumber,
      rollId: this.room.state.rollId,
      keptDiceSlots: this.room.state.keptDiceSlots,
    });
  }

  private handleReroll(playerRole: 'p1' | 'p2', socket: Socket | null): void {
    const err = this.room.state.validateReroll(playerRole);
    if (err) {
      socket?.emit('REROLL_REJECTED');
      return;
    }
    this.room.state.turnPhase = 'collecting';
    this.io.to(this.room.id).emit('COLLECT_TO_CUP', {
      turnNumber: this.room.state.turnNumber,
      rollId: this.room.state.rollId,
      keptIndices: this.room.state.keptDiceSlots,
    });
  }

  handleCollectionDone(playerRole: 'p1' | 'p2'): void {
    if (this.room.state.currentTurn !== playerRole) return;
    if (this.room.state.turnPhase !== 'collecting') return;

    this.room.physics.spawnNonKeptDiceInCup(this.room.state.keptDiceSlots);
    this.room.state.turnPhase = 'waiting_pour';
    this.room.state.canPour = true;
    this.io.to(this.room.id).emit('CAN_POUR', {
      turnNumber: this.room.state.turnNumber,
      rollId: this.room.state.rollId,
    });
  }

  handleSubmitScore(playerRole: 'p1' | 'p2', category: string): void {
    const state = this.room.state;
    const err = state.validateSubmitScore(playerRole, category);
    if (err) return;

    state.turnPhase = 'scoring';
    const { value, gameOver } = state.applyScore(playerRole, category);

    if (gameOver) {
      const winner = state.getWinner();
      this.io.to(this.room.id).emit('SCORE_CONFIRMED', {
        player: playerRole,
        category,
        value,
        scores: state.scores,
        nextTurn: state.currentTurn,
        turnNumber: state.turnNumber,
        rollId: state.rollId,
      });
      this.io.to(this.room.id).emit('GAME_OVER', {
        scores: state.scores,
        winner,
      });
      this.onGameFinished?.();
    } else {
      state.advanceTurn();
      this.room.physics.spawnNonKeptDiceInCup(state.keptDiceSlots);
      state.canPour = true;

      this.io.to(this.room.id).emit('SCORE_CONFIRMED', {
        player: playerRole,
        category,
        value,
        scores: state.scores,
        nextTurn: state.currentTurn,
        turnNumber: state.turnNumber,
        rollId: state.rollId,
      });
      this.io.to(this.room.id).emit('CAN_POUR', {
        turnNumber: state.turnNumber,
        rollId: state.rollId,
      });
      this.onTurnAdvanced?.();
    }
  }
}
