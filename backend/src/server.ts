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

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // When a user moves their cup (shaking phase)
  socket.on('CUP_TRANSFORM', (data) => {
    // Only process if it's the active player's turn (add turn logic later)
    gamePhysics.updateCupTransform(data.position, data.quaternion);
  });

  // When a user throws the dice
  socket.on('ROLL_DICE', (throwData) => {
    // Pause live broadcast loop? Or just run standalone calculation
    // Precalculate trajectory deterministically
    const result = gamePhysics.simulateRoll(throwData.velocity, throwData.angularVelocity);
    
    // Send the pre-calculated animation data to everyone
    io.emit('ROLL_RESULT', result);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Physics Loop (approx 60fps)
setInterval(() => {
  gamePhysics.step();
  const diceStates = gamePhysics.getDiceStates();
  
  // Broadcast the current positions of the dice to all clients
  // If we only broadcast during "SHAKE" phase, we should add phase checks here.
  io.emit('DICE_STATES', diceStates);
}, 1000 / 60);

app.get('/health', (req, res) => {
  res.send('Yacht Dice Backend is running!');
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
