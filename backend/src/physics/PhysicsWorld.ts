import * as CANNON from 'cannon-es';
import { YACHT_CONSTANTS, BOARD_CONSTANTS } from '@yacht/core';

export interface PourResult {
  diceTrajectory: Array<Array<{ position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }>>;
  cupTrajectory: Array<{ position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }>;
  finalValues: number[];
}

export class PhysicsWorld {
  public world: CANNON.World;
  public diceBodies: CANNON.Body[] = [];
  public cupBody: CANNON.Body;
  public cupLidBody: CANNON.Body;   // Transparent lid — active during drag, removed during pour
  public diceInCup: boolean[] = [true, true, true, true, true];
  public keptDice: boolean[] = [false, false, false, false, false];
  public currentDiceValues: number[] = [1, 1, 1, 1, 1];

  // Dice dimensions (2 units wide)
  private diceShape = new CANNON.Box(new CANNON.Vec3(1.0, 1.0, 1.0));
  private diceMass = 8; // 8kg (volume doubled)
  private defaultMaterial: CANNON.Material;
  private subSteps = 16;
  private subStepDt = 1 / 960; // 16 sub-steps × 1/960 s = 1/60 s per frame

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82 * 4.0, 0),
      allowSleep: true, // Required for allSleeping checks in simulatePour/simulateRoll
    });

    // Sub-stepping: the server physics loop calls step() at 60 Hz, but each call
    // runs 4 internal sub-steps at 1/240 s. This means the kinematic cup body
    // moves only 1/4 of the distance per sub-step, giving the solver 4× more
    // chances to detect and resolve dice-vs-cup-wall contacts before they tunnel.
    this.subSteps = 4;
    this.subStepDt = 1 / (60 * this.subSteps); // 1/240 s

    // Raise solver iterations (default 10 → 20) for tighter contact resolution
    (this.world.solver as any).iterations = 20;

    // Materials
    this.defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      {
        friction: 0.3,
        restitution: 0.3,
        // High stiffness = minimal penetration per step; relaxation 4 = stable convergence
        contactEquationStiffness: 1e9,
        contactEquationRelaxation: 4,
      }
    );
    this.world.addContactMaterial(defaultContactMaterial);

    // Floor
    const floorShape = new CANNON.Plane();
    const floorBody = new CANNON.Body({ mass: 0, material: this.defaultMaterial }); // Mass 0 makes it static
    floorBody.addShape(floorShape);
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Rotate to layout flat
    this.world.addBody(floorBody);

    // Invisible border walls — use PHYSICS_WALL_HEIGHT (much taller than visual)
    // to guarantee dice never escape, regardless of visual wall height.
    const { BOARD_SIZE, WALL_THICKNESS, PHYSICS_WALL_HEIGHT } = BOARD_CONSTANTS;
    const halfBoard = BOARD_SIZE / 2;                  // 8
    const hw = WALL_THICKNESS / 2;              // 0.5
    const totalWidth = BOARD_SIZE + WALL_THICKNESS * 2; // 18
    const wallHalfH = PHYSICS_WALL_HEIGHT / 2;
    const wallCenterY = PHYSICS_WALL_HEIGHT / 2;

    const borderBody = new CANNON.Body({ mass: 0, material: this.defaultMaterial });

    // Top & Bottom walls (-z, +z)
    const tbShape = new CANNON.Box(new CANNON.Vec3(totalWidth / 2, wallHalfH, hw));
    borderBody.addShape(tbShape, new CANNON.Vec3(0, wallCenterY, -(halfBoard + hw))); // Top
    borderBody.addShape(tbShape, new CANNON.Vec3(0, wallCenterY, (halfBoard + hw))); // Bottom

    // Left & Right walls (-x, +x)
    const lrShape = new CANNON.Box(new CANNON.Vec3(hw, wallHalfH, halfBoard));
    borderBody.addShape(lrShape, new CANNON.Vec3(-(halfBoard + hw), wallCenterY, 0)); // Left
    borderBody.addShape(lrShape, new CANNON.Vec3((halfBoard + hw), wallCenterY, 0)); // Right

    this.world.addBody(borderBody);

    // Invisible ceiling — covers the full board area at height = PHYSICS_WALL_HEIGHT.
    // Prevents dice from flying out over the walls or escaping the cup upward.
    // Made wider than the board to also cover the cup when dragged near the edges.
    const ceilingBody = new CANNON.Body({ mass: 0, material: this.defaultMaterial });
    const ceilingHalfSize = (BOARD_SIZE + WALL_THICKNESS * 2) / 2 + 10; // 19 — generous margin
    const ceilingShape = new CANNON.Box(new CANNON.Vec3(ceilingHalfSize, 0.5, ceilingHalfSize));
    ceilingBody.addShape(ceilingShape, new CANNON.Vec3(0, PHYSICS_WALL_HEIGHT, 0));
    // Flip normal downward so the ceiling face points inward (into the play area)
    ceilingBody.quaternion.setFromEuler(Math.PI, 0, 0);
    this.world.addBody(ceilingBody);

    // Initialize Dice
    for (let i = 0; i < YACHT_CONSTANTS.DICE_COUNT; i++) {
      const dice = new CANNON.Body({
        mass: this.diceMass,
        shape: this.diceShape,
        material: this.defaultMaterial,
        position: new CANNON.Vec3(0, 5 + i, 0) // Will be repositioned by spawnDiceInCup
      });
      dice.allowSleep = true;
      dice.sleepSpeedLimit = 0.1;  // m/s — body is "almost still"
      dice.sleepTimeLimit = 0.5;   // must stay below speed limit for 0.5s to enter sleep
      this.world.addBody(dice);
      this.diceBodies.push(dice);
    }

    // Initialize Cup (Kinematic, meaning we manually control its position from client input)
    this.cupBody = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(0, 5, 0)
    });
    // Cup base
    const cupBaseShape = new CANNON.Cylinder(4, 4, 1.0, 16);
    this.cupBody.addShape(cupBaseShape, new CANNON.Vec3(0, -4, 0));

    const wallHeight = 8.0;
    const wallThickness = 4.0;   // thick outer shell; sub-stepping is the primary fix
    const innerRadius = 4.0;
    const segmentCount = 8;
    const segmentAngle = (2 * Math.PI) / segmentCount;
    const segmentWidth = 2 * innerRadius * Math.tan(segmentAngle / 2); // ~3.31

    for (let i = 0; i < segmentCount; i++) {
      const angle = i * segmentAngle;
      const wallShape = new CANNON.Box(new CANNON.Vec3(segmentWidth / 2, wallHeight / 2, wallThickness / 2));
      // Offset center so the *inner* face sits exactly at innerRadius
      const wallCenterRadius = innerRadius + wallThickness / 2;
      const wx = Math.sin(angle) * wallCenterRadius;
      const wz = Math.cos(angle) * wallCenterRadius;
      const wallOffset = new CANNON.Vec3(wx, 0, wz);
      const wallQuat = new CANNON.Quaternion();
      wallQuat.setFromEuler(0, angle, 0);
      this.cupBody.addShape(wallShape, wallOffset, wallQuat);
    }

    this.world.addBody(this.cupBody);

    // Cup lid — a thin disc at the cup opening (local y = +2).
    // During drag it follows the cup, physically preventing dice from escaping upward.
    // Moved far away at the start of simulatePour() so dice can fall out freely.
    this.cupLidBody = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(0, 5 + wallHeight / 2 + 0.5, 0), // cup y(5) + half wall height + half lid thickness
    });
    // Lid is roughly the radius of the outer bounding box
    const lidRadius = innerRadius + wallThickness;
    const cupLidShape = new CANNON.Cylinder(lidRadius, lidRadius, 1.0, 16);
    this.cupLidBody.addShape(cupLidShape);
    this.world.addBody(this.cupLidBody);

    // Spawn dice inside cup initially
    this.spawnDiceInCup();
  }

  spawnDiceInCup(): void {
    // Position dice inside cup in a 2x2 grid + 1 on top
    const cupPos = this.cupBody.position;
    const offsets = [
      { x: -1.2, y: -2.5, z: -1.2 },
      { x: 1.2, y: -2.5, z: -1.2 },
      { x: -1.2, y: -2.5, z: 1.2 },
      { x: 1.2, y: -2.5, z: 1.2 },
      { x: 0.0, y: -0.5, z: 0.0 }, // top layer
    ];
    this.diceBodies.forEach((dice, i) => {
      const off = offsets[i];
      dice.position.set(cupPos.x + off.x, cupPos.y + off.y, cupPos.z + off.z);
      dice.velocity.setZero();
      dice.angularVelocity.setZero();
      dice.quaternion.set(0, 0, 0, 1);
      dice.wakeUp();
    });
    this.diceInCup = [true, true, true, true, true];
  }

  collectDice(dieIndex: number): void {
    if (this.diceInCup[dieIndex]) return;
    const cupPos = this.cupBody.position;
    // Place inside cup near bottom with slight random offset
    const dice = this.diceBodies[dieIndex];
    dice.position.set(
      cupPos.x + (Math.random() - 0.5) * 0.8,
      cupPos.y - 1.0,
      cupPos.z + (Math.random() - 0.5) * 0.8
    );
    dice.velocity.setZero();
    dice.angularVelocity.setZero();
    dice.wakeUp();
    this.diceInCup[dieIndex] = true;
  }

  checkCollection(): void {
    const cupPos = this.cupBody.position;
    for (let i = 0; i < this.diceBodies.length; i++) {
      if (this.diceInCup[i]) continue;
      if (this.keptDice[i]) continue; // don't auto-collect kept dice
      const dicePos = this.diceBodies[i].position;
      const dx = dicePos.x - cupPos.x;
      const dz = dicePos.z - cupPos.z;
      const distXZ = Math.sqrt(dx * dx + dz * dz);
      // Check if dice is under the cup's opening (XZ within radius, Y below cup center)
      if (distXZ < 2.2 && dicePos.y < cupPos.y + 2.0) {
        this.collectDice(i);
      }
    }
  }

  spawnNonKeptDiceInCup(keptIndices: (number | null)[]): void {
    const keptSet = new Set(keptIndices.filter(i => i !== null) as number[]);
    // Determine which dice are kept
    this.keptDice = this.diceBodies.map((_, i) => keptSet.has(i));
    this.diceInCup = this.diceBodies.map((_, i) => !keptSet.has(i));

    const cupPos = this.cupBody.position;
    const { TRAY_SLOT_COUNT, TRAY_SLOT_SPACING, BOARD_SIZE, WALL_THICKNESS, TRAY_DEPTH } = BOARD_CONSTANTS;
    const trayStartX = -((TRAY_SLOT_COUNT - 1) * TRAY_SLOT_SPACING) / 2;
    const trayCenterZ = -(BOARD_SIZE / 2 + WALL_THICKNESS + TRAY_DEPTH / 2);

    // 1. Position kept dice exactly in their slots based on the client order
    keptIndices.forEach((dieIdx, slotIdx) => {
      if (dieIdx === null) return;
      const dice = this.diceBodies[dieIdx];
      if (!dice) return;

      dice.position.set(
        trayStartX + slotIdx * TRAY_SLOT_SPACING,
        1.0,
        trayCenterZ
      );
      dice.velocity.setZero();
      dice.angularVelocity.setZero();
      this.snapRotationToValue(dice, this.currentDiceValues[dieIdx]);
      // Freeze kept dice so they don't get knocked over by rolling dice
      dice.type = CANNON.Body.STATIC;
      dice.updateMassProperties();
    });

    // 2. Position non-kept dice inside the cup
    const cupOffsets = [
      { x: -1.2, y: -2.5, z: -1.2 },
      { x: 1.2, y: -2.5, z: -1.2 },
      { x: -1.2, y: -2.5, z: 1.2 },
      { x: 1.2, y: -2.5, z: 1.2 },
      { x: 0.0, y: -0.5, z: 0.0 },
    ];
    let cupSlot = 0;
    this.diceBodies.forEach((dice, i) => {
      if (!keptSet.has(i)) {
        dice.type = CANNON.Body.DYNAMIC;
        dice.updateMassProperties();

        const off = cupOffsets[cupSlot % cupOffsets.length];
        dice.position.set(cupPos.x + off.x, cupPos.y + off.y, cupPos.z + off.z);
        dice.velocity.setZero();
        dice.angularVelocity.setZero();
        this.snapRotationToValue(dice, this.currentDiceValues[i]);
        
        // Prevent tumble/face-change while residing inside the cup before the roll
        dice.fixedRotation = true;
        dice.updateMassProperties();
        
        dice.wakeUp();
        cupSlot++;
      }
    });
  }

  /** Aligns the die exactly with an axis so the currently determined face is facing up (0,1,0) */
  private snapRotationToValue(body: CANNON.Body, forcedValue?: number): void {
    const faceNormals = [
      new CANNON.Vec3(0, 1, 0),   // 1
      new CANNON.Vec3(0, -1, 0),  // 6
      new CANNON.Vec3(1, 0, 0),   // 2
      new CANNON.Vec3(-1, 0, 0),  // 5
      new CANNON.Vec3(0, 0, 1),   // 3
      new CANNON.Vec3(0, 0, -1),  // 4
    ];
    const worldUp = new CANNON.Vec3(0, 1, 0);

    let bestFace = faceNormals[0];

    if (forcedValue !== undefined) {
      // Find the normal associated with forcedValue
      const targetIndices: Record<number, number> = { 1:0, 6:1, 2:2, 5:3, 3:4, 4:5 };
      bestFace = faceNormals[targetIndices[forcedValue]];
    } else {
      let maxDot = -Infinity;
      for (const localFace of faceNormals) {
        const worldFace = new CANNON.Vec3();
        body.quaternion.vmult(localFace, worldFace);
        const dot = worldFace.dot(worldUp);
        if (dot > maxDot) {
          maxDot = dot;
          bestFace = localFace;
        }
      }
    }

    // rotation that takes the 'bestFace' to 'worldUp'
    body.quaternion.setFromVectors(bestFace, worldUp);
  }

  allDiceInCup(): boolean {
    return this.diceInCup.every(v => v);
  }

  /** All non-kept dice are in the cup → ready to pour */
  allDiceReadyToPour(): boolean {
    return this.diceBodies.every((_, i) => this.diceInCup[i] || this.keptDice[i]);
  }

  simulatePour(
    cupPosition: { x: number; y: number; z: number },
    cupQuaternion: { x: number; y: number; z: number; w: number }
  ): PourResult {
    // Set cup to the provided position
    this.cupBody.position.set(cupPosition.x, cupPosition.y, cupPosition.z);
    this.cupBody.quaternion.set(cupQuaternion.x, cupQuaternion.y, cupQuaternion.z, cupQuaternion.w);

    // Remove lid before pour so dice can exit freely
    this.cupLidBody.position.set(0, -100, 0);

    // Ensure non-kept dice are awake and free to rotate
    this.diceBodies.forEach((d, i) => {
      if (!this.keptDice[i]) {
        d.fixedRotation = false;
        d.updateMassProperties();
        d.wakeUp();
      }
    });

    const diceTrajectory: PourResult['diceTrajectory'] = [];
    const cupTrajectory: PourResult['cupTrajectory'] = [];

    const startQuat = new CANNON.Quaternion(cupQuaternion.x, cupQuaternion.y, cupQuaternion.z, cupQuaternion.w);
    const startPos = new CANNON.Vec3(cupPosition.x, cupPosition.y, cupPosition.z);

    // Phase 1: Tilt cup to the LEFT (40 frames, ~0.67s) - rotate 130 degrees around Z axis
    const tiltFrames = 40;
    const tiltAngle = (130 * Math.PI) / 180;
    const tiltQuat = new CANNON.Quaternion();

    for (let f = 0; f < tiltFrames; f++) {
      const t = (f + 1) / tiltFrames;
      const angle = tiltAngle * t;
      tiltQuat.setFromEuler(0, 0, angle); // Z rotation → pours to the left (-X direction)
      const currentQuat = startQuat.clone();
      currentQuat.mult(tiltQuat, currentQuat);
      this.cupBody.quaternion.copy(currentQuat);
      this.cupBody.position.copy(startPos);

      for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(this.subStepDt); };
      diceTrajectory.push(this.getDiceStates());
      cupTrajectory.push({
        position: { x: this.cupBody.position.x, y: this.cupBody.position.y, z: this.cupBody.position.z },
        quaternion: { x: this.cupBody.quaternion.x, y: this.cupBody.quaternion.y, z: this.cupBody.quaternion.z, w: this.cupBody.quaternion.w }
      });
    }

    // Phase 2: Lift cup up to avoid interference (20 frames)
    const liftFrames = 20;
    const liftedQuat = this.cupBody.quaternion.clone();
    for (let f = 0; f < liftFrames; f++) {
      const t = (f + 1) / liftFrames;
      this.cupBody.position.set(startPos.x, startPos.y + t * 20, startPos.z);
      this.cupBody.quaternion.copy(liftedQuat);

      for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(this.subStepDt); };
      diceTrajectory.push(this.getDiceStates());
      cupTrajectory.push({
        position: { x: this.cupBody.position.x, y: this.cupBody.position.y, z: this.cupBody.position.z },
        quaternion: { x: this.cupBody.quaternion.x, y: this.cupBody.quaternion.y, z: this.cupBody.quaternion.z, w: this.cupBody.quaternion.w }
      });
    }

    // Phase 3: Wait for dice to settle (max 600 frames)
    const maxSettleFrames = 600;
    let calmFrames = 0;
    const requiredCalmFrames = 30; // 0.5 sec at 60fps
    const speedThresholdSq = 0.05; // ~0.22 m/s threshold

    for (let f = 0; f < maxSettleFrames; f++) {
      for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(this.subStepDt); };
      diceTrajectory.push(this.getDiceStates());
      cupTrajectory.push({
        position: { x: this.cupBody.position.x, y: this.cupBody.position.y, z: this.cupBody.position.z },
        quaternion: { x: this.cupBody.quaternion.x, y: this.cupBody.quaternion.y, z: this.cupBody.quaternion.z, w: this.cupBody.quaternion.w }
      });

      // Custom Hysteresis: Check if all dynamic dice are moving significantly slower than the visual threshold
      let allCalm = true;
      for (const b of this.diceBodies) {
        if (b.type === CANNON.Body.STATIC) continue;
        if (b.velocity.lengthSquared() > speedThresholdSq || b.angularVelocity.lengthSquared() > speedThresholdSq) {
          allCalm = false;
          break;
        }
      }

      if (allCalm) {
        calmFrames++;
      } else {
        calmFrames = 0;
      }

      const allSleeping = this.diceBodies.every(b => b.sleepState === CANNON.Body.SLEEPING);
      if (allSleeping || calmFrames >= requiredCalmFrames) {
        break;
      }
    }

    // Determine final face values
    const finalValues = this.getFinalDiceValues();
    this.currentDiceValues = finalValues;

    // Reset state
    this.diceInCup = [false, false, false, false, false];

    // Move cup to a default waiting position (off to the side, above board)
    this.cupBody.position.set(0, 5, 0);
    this.cupBody.quaternion.set(0, 0, 0, 1);

    return { diceTrajectory, cupTrajectory, finalValues };
  }

  private getFinalDiceValues(): number[] {
    const faceNormals = [
      { normal: new CANNON.Vec3(0, 1, 0), value: 1 },
      { normal: new CANNON.Vec3(0, -1, 0), value: 6 },
      { normal: new CANNON.Vec3(1, 0, 0), value: 2 },
      { normal: new CANNON.Vec3(-1, 0, 0), value: 5 },
      { normal: new CANNON.Vec3(0, 0, 1), value: 3 },
      { normal: new CANNON.Vec3(0, 0, -1), value: 4 },
    ];
    const upVector = new CANNON.Vec3(0, 1, 0);

    return this.diceBodies.map(body => {
      let maxValue = 1;
      let maxDot = -Infinity;

      for (const face of faceNormals) {
        const rotatedNormal = new CANNON.Vec3();
        body.quaternion.vmult(face.normal, rotatedNormal);
        const dot = rotatedNormal.dot(upVector);
        if (dot > maxDot) {
          maxDot = dot;
          maxValue = face.value;
        }
      }
      return maxValue;
    });
  }

  step() {
    // Run multiple sub-steps instead of one large step.
    // Each sub-step the kinematic cup moves a smaller distance,
    // preventing dice from tunneling through cup walls.
    for (let i = 0; i < this.subSteps; i++) {
      this.world.step(this.subStepDt);
    }
  }

  updateCupTransform(position: { x: number, y: number, z: number }, quaternion: { x: number, y: number, z: number, w: number }) {
    this.cupBody.position.set(position.x, position.y, position.z);
    this.cupBody.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

    // Move lid to the cup's top opening in world space
    const lidLocalOffset = new CANNON.Vec3(0, 4.0, 0);
    const lidWorldOffset = new CANNON.Vec3();
    this.cupBody.quaternion.vmult(lidLocalOffset, lidWorldOffset);
    this.cupLidBody.position.set(
      position.x + lidWorldOffset.x,
      position.y + lidWorldOffset.y,
      position.z + lidWorldOffset.z
    );
    this.cupLidBody.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

    // Wake up dice inside the cup so they react to cup movement
    // (sleeping dice ignore kinematic body motion)
    for (let i = 0; i < this.diceBodies.length; i++) {
      if (this.diceInCup[i]) {
        const d = this.diceBodies[i];
        if (d.fixedRotation) {
          d.fixedRotation = false;
          d.updateMassProperties();
        }
        d.wakeUp();
      }
    }
  }

  getDiceStates() {
    return this.diceBodies.map(body => ({
      position: { x: body.position.x, y: body.position.y, z: body.position.z },
      quaternion: { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w }
    }));
  }

  // Pre-calculate the entire roll deterministically
  simulateRoll(throwVelocity: { x: number, y: number, z: number }, throwAngular: { x: number, y: number, z: number }) {
    // 1. Give dice impulse
    this.diceBodies.forEach(dice => {
      dice.fixedRotation = false;
      dice.updateMassProperties();
      // Small random variations per dice so they don't stick together perfectly
      const vOffset = new CANNON.Vec3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
      dice.velocity.set(throwVelocity.x + vOffset.x, throwVelocity.y + vOffset.y, throwVelocity.z + vOffset.z);
      dice.angularVelocity.set(throwAngular.x + vOffset.x, throwAngular.y + vOffset.y, throwAngular.z + vOffset.z);
      dice.wakeUp(); // ensure they aren't sleeping
    });

    const trajectory = [];
    const maxSteps = 60 * 10; // 10 seconds timeout max
    let steps = 0;
    let calmFrames = 0;
    const requiredCalmFrames = 30;
    const speedThresholdSq = 0.05;

    // 2. Loop until all dice are asleep or timeout
    while (steps < maxSteps) {
      for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(this.subStepDt); };
      trajectory.push(this.getDiceStates());

      let allCalm = true;
      for (const b of this.diceBodies) {
        if (b.type === CANNON.Body.STATIC) continue;
        if (b.velocity.lengthSquared() > speedThresholdSq || b.angularVelocity.lengthSquared() > speedThresholdSq) {
          allCalm = false;
          break;
        }
      }

      if (allCalm) {
        calmFrames++;
      } else {
        calmFrames = 0;
      }

      const allSleeping = this.diceBodies.every(b => b.sleepState === CANNON.Body.SLEEPING);
      if (allSleeping || calmFrames >= requiredCalmFrames) {
        break;
      }

      steps++;
    }

    const finalValues = this.getFinalDiceValues();

    return { trajectory, finalValues };
  }
}
