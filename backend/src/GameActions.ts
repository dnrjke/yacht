import { Server } from 'socket.io';
import { Room } from './RoomManager';

export class GameActions {
  constructor(private room: Room, private io: Server) {}

  handleFromSocket(playerRole: 'p1' | 'p2', event: string, data: any): void {
    this.execute(playerRole, event, data);
  }

  handleFromAutoPlay(playerRole: 'p1' | 'p2', event: string, data: any): void {
    this.execute(playerRole, event, data);
  }

  private execute(playerRole: 'p1' | 'p2', event: string, data: any): void {
    const state = this.room.state;
    if (state.currentTurn !== playerRole) return;
    if (!state.isEventAllowed(event)) return;

    switch (event) {
      case 'POUR_CUP':
        this.handlePour(playerRole, data);
        break;
      case 'KEEP_DIE':
        this.handleKeep(playerRole, data.dieIndex);
        break;
      case 'UNKEEP_DIE':
        this.handleUnkeep(playerRole, data.dieIndex);
        break;
      case 'REROLL':
        this.handleReroll(playerRole);
        break;
      case 'SUBMIT_SCORE':
        this.handleSubmitScore(playerRole, data.category);
        break;
      case 'COLLECTION_DONE':
        this.handleCollectionDone(playerRole);
        break;
    }
  }

  private handlePour(playerRole: 'p1' | 'p2', data: { position: any; quaternion: any }): void {
    const state = this.room.state;
    const err = state.validatePour(playerRole);
    if (err) return;

    state.turnPhase = 'simulating';
    state.isSimulating = true;
    state.canPour = false;

    this.room.physics.updateCupTransform(data.position, data.quaternion);
    this.room.physics.step();
    const result = this.room.physics.simulatePour(data.position, data.quaternion);

    state.rollCount++;
    state.currentDiceValues = result.finalValues;
    state.isSimulating = false;
    state.turnPhase = 'placement';

    this.io.to(this.room.id).emit('POUR_RESULT', {
      ...result,
      rollCount: state.rollCount,
    });
  }

  private handleKeep(playerRole: 'p1' | 'p2', dieIndex: number): void {
    if (!this.room.state.validateKeep(playerRole, dieIndex)) return;
    if (this.room.state.keptDiceSlots.includes(dieIndex)) return;
    this.room.state.applyKeep(dieIndex);
    this.io.to(this.room.id).emit('KEPT_UPDATE', { keptDiceSlots: this.room.state.keptDiceSlots });
  }

  private handleUnkeep(playerRole: 'p1' | 'p2', dieIndex: number): void {
    if (!this.room.state.validateKeep(playerRole, dieIndex)) return;
    if (!this.room.state.keptDiceSlots.includes(dieIndex)) return;
    this.room.state.applyUnkeep(dieIndex);
    this.io.to(this.room.id).emit('KEPT_UPDATE', { keptDiceSlots: this.room.state.keptDiceSlots });
  }

  private handleReroll(playerRole: 'p1' | 'p2'): void {
    const err = this.room.state.validateReroll(playerRole);
    if (err) return;
    this.room.state.turnPhase = 'collecting';
    this.io.to(this.room.id).emit('COLLECT_TO_CUP', { keptIndices: this.room.state.keptDiceSlots });
  }

  handleCollectionDone(playerRole: 'p1' | 'p2'): void {
    if (this.room.state.currentTurn !== playerRole) return;
    if (this.room.state.turnPhase !== 'collecting') return;

    this.room.physics.spawnNonKeptDiceInCup(this.room.state.keptDiceSlots);
    this.room.state.turnPhase = 'waiting_pour';
    this.room.state.canPour = true;
    this.io.to(this.room.id).emit('CAN_POUR');
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
      });
      this.io.to(this.room.id).emit('GAME_OVER', {
        scores: state.scores,
        winner,
      });
    } else {
      state.advanceTurn();
      this.room.physics.spawnDiceInCup();
      state.canPour = true;

      this.io.to(this.room.id).emit('SCORE_CONFIRMED', {
        player: playerRole,
        category,
        value,
        scores: state.scores,
        nextTurn: state.currentTurn,
      });
      this.io.to(this.room.id).emit('CAN_POUR');
    }
  }
}
