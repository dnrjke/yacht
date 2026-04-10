/**
 * Yacht Dice — Physics Server (Local 2P)
 *
 * This server is a pure physics engine. It owns:
 * - Rapier 3D world (cup, dice, board colliders)
 * - 60fps physics loop emitting DICE_STATES
 * - Deterministic pour simulation (POUR_CUP -> POUR_RESULT)
 * - Dice collection (COLLECT_TO_CUP -> COLLECTION_DONE)
 *
 * It does NOT own:
 * - Player identity, turns, or scoring (client-side gameStore)
 * - Game phase transitions (client-side)
 * - Roll counting or turn limits (client-side)
 */
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { PhysicsWorld } from './physics/PhysicsWorld';

dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Define specific origins in production
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

async function main() {
  // RAPIER WASM init happens inside PhysicsWorld.create()
  const gamePhysics = await PhysicsWorld.create();
  let isSimulating = false;

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 새 클라이언트 접속 시 주사위를 컵 안으로 리셋
    gamePhysics.spawnDiceInCup();

    // When a user moves their cup (shaking phase)
    socket.on('CUP_TRANSFORM', (data) => {
      gamePhysics.updateCupTransform(data.position, data.quaternion);
    });

    // Pour cup: tilt and release dice
    socket.on('POUR_CUP', (data: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }) => {
      if (!gamePhysics.allDiceReadyToPour()) return;
      isSimulating = true;
      const result = gamePhysics.simulatePour(data.position, data.quaternion);
      isSimulating = false;
      io.emit('POUR_RESULT', result);
    });

    // Client finished return-to-cup animation — move non-kept dice into cup
    socket.on('COLLECT_TO_CUP', (data?: { keptIndices?: (number | null)[] }) => {
      const keptIndices = data?.keptIndices ?? [];
      gamePhysics.spawnNonKeptDiceInCup(keptIndices);
      // Tell all clients that collection is done so they can resume syncing physics states
      io.emit('COLLECTION_DONE');
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });

  // Physics Loop (approx 60fps)
  setInterval(() => {
    if (isSimulating) return;
    gamePhysics.step();
    const diceStates = gamePhysics.getDiceStates();

    io.emit('DICE_STATES', { diceStates });
  }, 1000 / 60);

  app.get('/health', (req, res) => {
    res.send('Yacht Dice Backend is running!');
  });

  httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

main();
