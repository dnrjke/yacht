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

// Basic physics world setup for deterministic simulation
const gamePhysics = new PhysicsWorld();
let isSimulating = false; // true while simulatePour/simulateRoll is running synchronously

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Spawn dice in cup for new connection
  gamePhysics.spawnDiceInCup();

  // When a user moves their cup (shaking phase)
  socket.on('CUP_TRANSFORM', (data) => {
    gamePhysics.updateCupTransform(data.position, data.quaternion);
    // Check if any dice on the board should be collected into the cup
    gamePhysics.checkCollection();
  });

  // When a user throws the dice (legacy button)
  socket.on('ROLL_DICE', (throwData) => {
    isSimulating = true;
    const result = gamePhysics.simulateRoll(throwData.velocity, throwData.angularVelocity);
    isSimulating = false;
    io.emit('ROLL_RESULT', result);
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
  socket.on('COLLECT_TO_CUP', (data?: { keptIndices?: number[] }) => {
    const keptIndices = data?.keptIndices ?? [];
    gamePhysics.spawnNonKeptDiceInCup(keptIndices);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Physics Loop (approx 60fps)
setInterval(() => {
  if (isSimulating) return; // Skip while simulatePour/simulateRoll owns the physics world
  gamePhysics.step();
  gamePhysics.checkCollection();
  const diceStates = gamePhysics.getDiceStates();

  io.emit('DICE_STATES', { diceStates, diceInCup: gamePhysics.diceInCup });
}, 1000 / 60);

app.get('/health', (req, res) => {
  res.send('Yacht Dice Backend is running!');
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
