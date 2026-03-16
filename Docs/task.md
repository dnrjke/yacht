# Yacht Dice Game Task List

- [x] 1. Planning & Architecture
  - [x] Define tech stack and structure
  - [x] Design server-client physics synchronization strategy
  - [x] Review plan with user

- [/] 2. Initial Setup
  - [ ] Initialize frontend (React + TS + Vite + Zustand)
  - [ ] Initialize backend (Node.js + Express + Socket.io)
  - [ ] Set up Supabase project and DB schema

- [ ] 3. Core Physics & 3D Engine (Three.js + Cannon-es)
  - [ ] Setup game scene, lighting, camera
  - [ ] Implement Dice and Cup 3D models and physics bodies
  - [ ] Implement dice rolling physics

- [ ] 4. Multiplayer & Synchronization
  - [ ] Implement Socket.io connectivity and room management
  - [ ] Implement real-time cup shaking sync
  - [ ] Implement deterministic roll pre-calculation and client playback

- [ ] 5. Game Logic & UI Flow
  - [ ] Implement Hybrid Loading (Preload core, steam rest)
  - [ ] Build Splash and "Touch to start" screens
  - [ ] Build Main Menu (Multiplayer, Settings)
  - [ ] Implement Yacht Dice rules and scoring logic
  - [ ] Build Game Screen UI (Scoreboard and controls)
  - [ ] Add `?debug` flag support for performance and physics debugging
  - [ ] Connect state to Zustand and UI

- [ ] 6. Deployment
  - [ ] Deploy backend to Koyeb
  - [ ] Deploy frontend to Vercel
