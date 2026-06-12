import RAPIER from '@dimforge/rapier3d-compat';
import { YACHT_CONSTANTS, BOARD_CONSTANTS, CUP_DICE_OFFSETS, getTraySlotPosition } from '@yacht/core';

export interface PourResult {
  diceTrajectory: Array<Array<{ position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }>>;
  cupTrajectory: Array<{ position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }>;
  finalValues: number[];
}

function rotateVec3ByQuat(
  v: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number }
): { x: number; y: number; z: number } {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

function quatFromVectors(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number }
): { x: number; y: number; z: number; w: number } {
  const cx = from.y * to.z - from.z * to.y;
  const cy = from.z * to.x - from.x * to.z;
  const cz = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y + from.z * to.z;
  const w = 1 + dot;

  if (w < 1e-6) {
    if (Math.abs(from.x) > Math.abs(from.z)) {
      return normalize({ x: -from.y, y: from.x, z: 0, w: 0 });
    }
    return normalize({ x: 0, y: -from.z, z: from.y, w: 0 });
  }

  return normalize({ x: cx, y: cy, z: cz, w });
}

function quatFromAxisAngle(
  axis: { x: number; y: number; z: number },
  angle: number
): { x: number; y: number; z: number; w: number } {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

function quatMultiply(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number }
): { x: number; y: number; z: number; w: number } {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function normalize(q: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-10) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

function lengthSq3(v: { x: number; y: number; z: number }): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

function quatInverse(q: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export class PhysicsWorld {
  public world!: RAPIER.World;
  public diceBodies: RAPIER.RigidBody[] = [];
  public cupBody!: RAPIER.RigidBody;
  public cupLidBody!: RAPIER.RigidBody;
  public diceInCup: boolean[] = [true, true, true, true, true];
  public keptDice: boolean[] = [false, false, false, false, false];
  public currentDiceValues: number[] = [1, 1, 1, 1, 1];

  private diceMass = 8;
  private subSteps = 4;
  private subStepDt = 1 / (60 * 4);

  private pendingCupPos: { x: number; y: number; z: number } | null = null;
  private pendingCupQuat: { x: number; y: number; z: number; w: number } | null = null;

  private borderWallColliders: RAPIER.Collider[] = [];
  private wallsEnabled = false;

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.82 * 4.0, z: 0 });
    this.world.timestep = this.subStepDt;
    this.world.integrationParameters.numSolverIterations = 16;

    const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const floorBody = this.world.createRigidBody(floorDesc);
    const floorCollider = RAPIER.ColliderDesc.cuboid(50, 0.5, 50)
      .setFriction(0.6)
      .setRestitution(0.1);
    this.world.createCollider(floorCollider, floorBody);

    const { BOARD_SIZE, WALL_THICKNESS, PHYSICS_WALL_HEIGHT, CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;
    const halfBoard = BOARD_SIZE / 2;
    const hw = WALL_THICKNESS / 2;
    const totalWidth = BOARD_SIZE + WALL_THICKNESS * 2;
    const wallHalfH = PHYSICS_WALL_HEIGHT / 2;
    const wallCenterY = PHYSICS_WALL_HEIGHT / 2;

    const wallDesc = RAPIER.RigidBodyDesc.fixed();
    const wallBody = this.world.createRigidBody(wallDesc);

    const tbCollider = () => RAPIER.ColliderDesc.cuboid(totalWidth / 2, wallHalfH, hw)
      .setFriction(0.5).setRestitution(0.1);
    this.borderWallColliders.push(
      this.world.createCollider(tbCollider().setTranslation(0, wallCenterY, -(halfBoard + hw)), wallBody),
      this.world.createCollider(tbCollider().setTranslation(0, wallCenterY, (halfBoard + hw)), wallBody),
    );

    const lrCollider = () => RAPIER.ColliderDesc.cuboid(hw, wallHalfH, halfBoard)
      .setFriction(0.5).setRestitution(0.1);
    this.borderWallColliders.push(
      this.world.createCollider(lrCollider().setTranslation(-(halfBoard + hw), wallCenterY, 0), wallBody),
      this.world.createCollider(lrCollider().setTranslation((halfBoard + hw), wallCenterY, 0), wallBody),
    );

    for (const c of this.borderWallColliders) { c.setEnabled(false); }

    const ceilingHalfSize = (BOARD_SIZE + WALL_THICKNESS * 2) / 2 + 10;
    const ceilingCollider = RAPIER.ColliderDesc.cuboid(ceilingHalfSize, 0.5, ceilingHalfSize)
      .setTranslation(0, PHYSICS_WALL_HEIGHT, 0);
    this.world.createCollider(ceilingCollider, wallBody);

    for (let i = 0; i < YACHT_CONSTANTS.DICE_COUNT; i++) {
      const diceDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(CUP_REST_X, CUP_REST_Y + i, CUP_REST_Z)
        .setCcdEnabled(true)
        .setSoftCcdPrediction(2.0)
        .setCanSleep(true)
        .setLinearDamping(0.1)
        .setAngularDamping(0.2);
      const diceBody = this.world.createRigidBody(diceDesc);

      const diceCollider = RAPIER.ColliderDesc.cuboid(1.0, 1.0, 1.0)
        .setMass(this.diceMass)
        .setFriction(0.5)
        .setRestitution(0.15);
      this.world.createCollider(diceCollider, diceBody);

      this.diceBodies.push(diceBody);
    }

    const cupDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
    this.cupBody = this.world.createRigidBody(cupDesc);

    const bowlBaseY = -4.0;
    const bowlDepth = 0.6;
    const bowlRings = 3;
    const bowlInnerR = 0;
    const bowlOuterR = 4.0;
    const ringWidth = bowlOuterR / bowlRings;

    for (let r = 0; r < bowlRings; r++) {
      const rInner = bowlInnerR + r * ringWidth;
      const rOuter = rInner + ringWidth;
      const rMid = (rInner + rOuter) / 2;

      const tNorm = rMid / bowlOuterR;
      const ringY = bowlBaseY - bowlDepth * (1 - tNorm * tNorm);
      const slopeAngle = Math.atan2(bowlDepth * 2 * tNorm, bowlOuterR);

      const segs = 16;
      const segAngle = (2 * Math.PI) / segs;
      const segArc = 2 * rMid * Math.tan(segAngle / 2);
      const segThickness = 1.0;

      for (let s = 0; s < segs; s++) {
        const angle = s * segAngle;
        const sx = Math.sin(angle) * rMid;
        const sz = Math.cos(angle) * rMid;

        const radialQuat = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle);
        const tiltQuat = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -slopeAngle);
        const finalQuat = quatMultiply(radialQuat, tiltQuat);

        const segCollider = RAPIER.ColliderDesc.cuboid(
          Math.max(segArc / 2, 0.3), segThickness / 2, ringWidth / 2
        )
          .setTranslation(sx, ringY, sz)
          .setRotation(finalQuat)
          .setFriction(0.5)
          .setRestitution(0.1);
        this.world.createCollider(segCollider, this.cupBody);
      }
    }

    const bumpHeight = 0.35;
    const bumpRadius = 0.3;
    const centralBump = RAPIER.ColliderDesc.cuboid(bumpRadius, bumpHeight / 2, bumpRadius)
      .setTranslation(0, bowlBaseY - bowlDepth + bumpHeight / 2, 0)
      .setFriction(0.4)
      .setRestitution(0.2);
    this.world.createCollider(centralBump, this.cupBody);
    const bumpRingR = 2.2;
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const tNorm = bumpRingR / bowlOuterR;
      const bumpY = bowlBaseY - bowlDepth * (1 - tNorm * tNorm) + bumpHeight / 2;
      const bump = RAPIER.ColliderDesc.cuboid(bumpRadius, bumpHeight / 2, bumpRadius)
        .setTranslation(Math.sin(angle) * bumpRingR, bumpY, Math.cos(angle) * bumpRingR)
        .setRotation(quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle + Math.PI / 5))
        .setFriction(0.4)
        .setRestitution(0.2);
      this.world.createCollider(bump, this.cupBody);
    }

    const wallHeight = 8.0;
    const wallThickness = 4.0;
    const innerRadius = 4.0;
    const segmentCount = 16;
    const segmentAngle = (2 * Math.PI) / segmentCount;
    const segmentWidth = 2 * innerRadius * Math.tan(segmentAngle / 2);

    for (let i = 0; i < segmentCount; i++) {
      const angle = i * segmentAngle;
      const wallCenterRadius = innerRadius + wallThickness / 2;
      const wx = Math.sin(angle) * wallCenterRadius;
      const wz = Math.cos(angle) * wallCenterRadius;

      const segCollider = RAPIER.ColliderDesc.cuboid(segmentWidth / 2, wallHeight / 2, wallThickness / 2)
        .setTranslation(wx, 0, wz)
        .setRotation(quatFromAxisAngle({ x: 0, y: 1, z: 0 }, angle))
        .setFriction(0.5)
        .setRestitution(0.1);
      this.world.createCollider(segCollider, this.cupBody);
    }

    const safetyDiscHalfH = 0.2;
    const safetyDiscCollider = RAPIER.ColliderDesc.cylinder(safetyDiscHalfH, bowlOuterR - 0.5)
      .setTranslation(0, bowlBaseY - bowlDepth - 0.5 - safetyDiscHalfH, 0)
      .setFriction(0.5)
      .setRestitution(0.1);
    this.world.createCollider(safetyDiscCollider, this.cupBody);

    const lidRadius = innerRadius + wallThickness;
    const lidDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(CUP_REST_X, CUP_REST_Y + wallHeight / 2 + 0.5, CUP_REST_Z);
    this.cupLidBody = this.world.createRigidBody(lidDesc);

    const lidCollider = RAPIER.ColliderDesc.cylinder(0.5, lidRadius)
      .setFriction(0.5)
      .setRestitution(0.1);
    this.world.createCollider(lidCollider, this.cupLidBody);

    this.spawnDiceInCup();
  }

  spawnDiceInCup(): void {
    const cupPos = this.cupBody.translation();
    this.diceBodies.forEach((dice, i) => {
      dice.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      const off = CUP_DICE_OFFSETS[i];
      dice.setTranslation({ x: cupPos.x + off.x, y: cupPos.y + off.y, z: cupPos.z + off.z }, true);
      dice.setLinvel({ x: 0, y: 0, z: 0 }, true);
      dice.setAngvel({ x: 0, y: 0, z: 0 }, true);
      dice.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      dice.lockRotations(true, true);
      dice.wakeUp();
    });
    this.diceInCup = [true, true, true, true, true];
    this.keptDice = [false, false, false, false, false];
    this.currentDiceValues = [1, 1, 1, 1, 1];
  }

  resetForNewGame(): void {
    const { CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;
    const cupRotation = { x: 0, y: 0, z: 0, w: 1 };

    this.setCupCollidersEnabled(true);
    this.setBorderWallsEnabled(false);

    this.cupBody.setTranslation({ x: CUP_REST_X, y: CUP_REST_Y, z: CUP_REST_Z }, true);
    this.cupBody.setRotation(cupRotation, true);
    this.cupBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y, z: CUP_REST_Z });
    this.cupBody.setNextKinematicRotation(cupRotation);

    this.cupLidBody.setTranslation({ x: CUP_REST_X, y: CUP_REST_Y + 4.5, z: CUP_REST_Z }, true);
    this.cupLidBody.setRotation(cupRotation, true);
    this.cupLidBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y + 4.5, z: CUP_REST_Z });
    this.cupLidBody.setNextKinematicRotation(cupRotation);

    this.pendingCupPos = null;
    this.pendingCupQuat = null;
    this.spawnDiceInCup();
  }

  spawnNonKeptDiceInCup(keptIndices: (number | null)[]): void {
    const keptSet = new Set(keptIndices.filter(i => i !== null) as number[]);
    this.keptDice = this.diceBodies.map((_, i) => keptSet.has(i));
    this.diceInCup = this.diceBodies.map((_, i) => !keptSet.has(i));

    const cupPos = this.cupBody.translation();

    keptIndices.forEach((dieIdx, slotIdx) => {
      if (dieIdx === null) return;
      const dice = this.diceBodies[dieIdx];
      if (!dice) return;

      const trayPos = getTraySlotPosition(slotIdx);
      dice.setTranslation(trayPos, true);
      dice.setLinvel({ x: 0, y: 0, z: 0 }, true);
      dice.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.snapRotationToValue(dice, this.currentDiceValues[dieIdx]);
      dice.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    });

    let cupSlot = 0;
    this.diceBodies.forEach((dice, i) => {
      if (!keptSet.has(i)) {
        dice.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

        const off = CUP_DICE_OFFSETS[cupSlot % CUP_DICE_OFFSETS.length];
        dice.setTranslation({ x: cupPos.x + off.x, y: cupPos.y + off.y, z: cupPos.z + off.z }, true);
        dice.setLinvel({ x: 0, y: 0, z: 0 }, true);
        dice.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.snapRotationToValue(dice, this.currentDiceValues[i]);
        dice.lockRotations(true, true);
        dice.wakeUp();
        cupSlot++;
      }
    });
  }

  allDiceReadyToPour(): boolean {
    return this.diceBodies.every((_, i) => this.diceInCup[i] || this.keptDice[i]);
  }

  private static readonly CUP_INNER_RADIUS = 4.0;
  private static readonly CUP_BOWL_BASE_Y = -4.0;
  private static readonly CUP_WALL_HALF_HEIGHT = 4.0;

  private isDiceInsideCup(diceIndex: number): boolean {
    const cupPos = this.cupBody.translation();
    const cupRot = this.cupBody.rotation();
    const dicePos = this.diceBodies[diceIndex].translation();

    const rel = { x: dicePos.x - cupPos.x, y: dicePos.y - cupPos.y, z: dicePos.z - cupPos.z };
    const local = rotateVec3ByQuat(rel, quatInverse(cupRot));

    const margin = 1.0;
    const horizDist = Math.sqrt(local.x * local.x + local.z * local.z);
    return horizDist < PhysicsWorld.CUP_INNER_RADIUS + margin
      && local.y > PhysicsWorld.CUP_BOWL_BASE_Y - margin
      && local.y < PhysicsWorld.CUP_WALL_HALF_HEIGHT + margin;
  }

  private allDiceExitedCup(): boolean {
    for (let i = 0; i < this.diceBodies.length; i++) {
      if (this.keptDice[i]) continue;
      if (this.isDiceInsideCup(i)) return false;
    }
    return true;
  }

  private setCupCollidersEnabled(enabled: boolean): void {
    const numColliders = this.cupBody.numColliders();
    for (let i = 0; i < numColliders; i++) {
      this.cupBody.collider(i).setEnabled(enabled);
    }
  }

  setBorderWallsEnabled(enabled: boolean): void {
    if (this.wallsEnabled === enabled) return;
    this.wallsEnabled = enabled;
    for (const c of this.borderWallColliders) {
      c.setEnabled(enabled);
    }
  }

  updateCupTransform(position: { x: number; y: number; z: number }, quaternion: { x: number; y: number; z: number; w: number }): void {
    this.setBorderWallsEnabled(false);
    this.pendingCupPos = { x: position.x, y: position.y, z: position.z };
    this.pendingCupQuat = { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };

    for (let i = 0; i < this.diceBodies.length; i++) {
      if (this.diceInCup[i]) {
        const d = this.diceBodies[i];
        d.lockRotations(false, true);
        d.wakeUp();
      }
    }
  }

  step(): boolean {
    if (this.pendingCupPos && this.pendingCupQuat) {
      const prevPos = this.cupBody.translation();
      const prevRot = this.cupBody.rotation();
      const targetPos = this.pendingCupPos;
      const targetRot = this.pendingCupQuat;

      for (let i = 0; i < this.subSteps; i++) {
        const t = (i + 1) / this.subSteps;

        const interpPos = {
          x: prevPos.x + (targetPos.x - prevPos.x) * t,
          y: prevPos.y + (targetPos.y - prevPos.y) * t,
          z: prevPos.z + (targetPos.z - prevPos.z) * t,
        };
        const interpQuat = normalize({
          x: prevRot.x + (targetRot.x - prevRot.x) * t,
          y: prevRot.y + (targetRot.y - prevRot.y) * t,
          z: prevRot.z + (targetRot.z - prevRot.z) * t,
          w: prevRot.w + (targetRot.w - prevRot.w) * t,
        });

        this.cupBody.setNextKinematicTranslation(interpPos);
        this.cupBody.setNextKinematicRotation(interpQuat);

        const lidOffset = rotateVec3ByQuat({ x: 0, y: 4.5, z: 0 }, interpQuat);
        this.cupLidBody.setNextKinematicTranslation({
          x: interpPos.x + lidOffset.x,
          y: interpPos.y + lidOffset.y,
          z: interpPos.z + lidOffset.z,
        });
        this.cupLidBody.setNextKinematicRotation(interpQuat);

        this.world.step();
      }

      this.pendingCupPos = null;
      this.pendingCupQuat = null;
      return true;
    }

    if (this.diceBodies.every(b => b.isSleeping())) {
      return false;
    }

    for (let i = 0; i < this.subSteps; i++) {
      this.world.step();
    }
    return true;
  }

  getDiceStates(): Array<{ position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }> {
    return this.diceBodies.map(body => {
      const pos = body.translation();
      const rot = body.rotation();
      return {
        position: { x: pos.x, y: pos.y, z: pos.z },
        quaternion: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      };
    });
  }

  simulatePour(
    cupPosition: { x: number; y: number; z: number },
    cupQuaternion: { x: number; y: number; z: number; w: number }
  ): PourResult {
    const { BOARD_SIZE, POUR_BOUNDARY_MARGIN, CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;

    const diceTrajectory: PourResult['diceTrajectory'] = [];
    const cupTrajectory: PourResult['cupTrajectory'] = [];

    const recordFrame = () => {
      diceTrajectory.push(this.getDiceStates());
      const cPos = this.cupBody.translation();
      const cRot = this.cupBody.rotation();
      cupTrajectory.push({
        position: { x: cPos.x, y: cPos.y, z: cPos.z },
        quaternion: { x: cRot.x, y: cRot.y, z: cRot.z, w: cRot.w },
      });
    };

    const stepPhysics = () => {
      for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(); }
    };

    type Vec3 = { x: number; y: number; z: number };
    type Quat = { x: number; y: number; z: number; w: number };
    const stepWithCup = (prevPos: Vec3, prevRot: Quat, targetPos: Vec3, targetRot: Quat) => {
      for (let s = 0; s < this.subSteps; s++) {
        const t = (s + 1) / this.subSteps;
        this.cupBody.setNextKinematicTranslation({
          x: prevPos.x + (targetPos.x - prevPos.x) * t,
          y: prevPos.y + (targetPos.y - prevPos.y) * t,
          z: prevPos.z + (targetPos.z - prevPos.z) * t,
        });
        this.cupBody.setNextKinematicRotation(normalize({
          x: prevRot.x + (targetRot.x - prevRot.x) * t,
          y: prevRot.y + (targetRot.y - prevRot.y) * t,
          z: prevRot.z + (targetRot.z - prevRot.z) * t,
          w: prevRot.w + (targetRot.w - prevRot.w) * t,
        }));
        this.world.step();
      }
    };

    const halfBound = BOARD_SIZE / 2 - POUR_BOUNDARY_MARGIN;
    const clampedPosition = {
      x: Math.max(-halfBound, Math.min(halfBound, cupPosition.x)),
      y: cupPosition.y,
      z: Math.max(-halfBound, Math.min(halfBound, cupPosition.z)),
    };
    const needsCorrection = (
      clampedPosition.x !== cupPosition.x ||
      clampedPosition.z !== cupPosition.z
    );

    this.cupBody.setNextKinematicTranslation(cupPosition);
    this.cupBody.setNextKinematicRotation(cupQuaternion);

    if (needsCorrection) {
      const corrDx = clampedPosition.x - cupPosition.x;
      const corrDz = clampedPosition.z - cupPosition.z;
      const corrDist = Math.sqrt(corrDx * corrDx + corrDz * corrDz);
      const SPEED_UNITS_PER_FRAME = 0.5;
      const correctionFrames = Math.max(10, Math.round(corrDist / SPEED_UNITS_PER_FRAME));
      const corrEaseOut = (t: number) => 1 - (1 - t) * (1 - t);
      let corrPrevPos = { x: cupPosition.x, y: cupPosition.y, z: cupPosition.z };
      for (let f = 0; f < correctionFrames; f++) {
        const t = corrEaseOut((f + 1) / correctionFrames);
        const interpPos = {
          x: cupPosition.x + corrDx * t,
          y: cupPosition.y,
          z: cupPosition.z + corrDz * t,
        };

        const lidOffset = rotateVec3ByQuat({ x: 0, y: 4.5, z: 0 }, cupQuaternion);
        this.cupLidBody.setNextKinematicTranslation({
          x: interpPos.x + lidOffset.x,
          y: interpPos.y + lidOffset.y,
          z: interpPos.z + lidOffset.z,
        });

        stepWithCup(corrPrevPos, cupQuaternion, interpPos, cupQuaternion);
        corrPrevPos = interpPos;
        recordFrame();
      }
    }

    this.setBorderWallsEnabled(true);
    this.cupLidBody.setNextKinematicTranslation({ x: 0, y: -100, z: 0 });

    this.diceBodies.forEach((d, i) => {
      if (!this.keptDice[i]) {
        d.lockRotations(false, true);
        d.wakeUp();
      }
    });

    const startPos = needsCorrection ? clampedPosition : { x: cupPosition.x, y: cupPosition.y, z: cupPosition.z };
    const startQuat = { x: cupQuaternion.x, y: cupQuaternion.y, z: cupQuaternion.z, w: cupQuaternion.w };
    const restPos = { x: CUP_REST_X, y: CUP_REST_Y, z: CUP_REST_Z };
    const identityQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };

    const TILT_FRAMES = 35;
    const TILT_ANGLE = (130 * Math.PI) / 180;
    const POUR_FRAMES = 14;
    const POUR_FORWARD_DIST = 3;
    const POUR_EXTRA_TILT_DEG = 10;
    const RETURN_FRAMES = 40;
    const RETURN_ARC_HEIGHT = 5;

    const dx = 0 - startPos.x;
    const dz = 0 - startPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const tiltAxis = dist > 0.1
      ? { x: dz / dist, y: 0, z: -dx / dist }
      : { x: 0, y: 0, z: 1 };

    const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

    let prevPos: Vec3 = { ...startPos };
    let prevRot: Quat = { ...startQuat };

    for (let f = 0; f < TILT_FRAMES; f++) {
      const t = (f + 1) / TILT_FRAMES;
      const tiltQuat = quatFromAxisAngle(tiltAxis, TILT_ANGLE * t);
      const currentQuat = normalize(quatMultiply(tiltQuat, startQuat));

      stepWithCup(prevPos, prevRot, startPos, currentQuat);
      prevPos = { ...startPos };
      prevRot = currentQuat;
      recordFrame();
    }

    const tiltedQuat = normalize(quatMultiply(
      quatFromAxisAngle(tiltAxis, TILT_ANGLE), startQuat
    ));

    const pourDir = dist > 0.1 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 0 };
    const POUR_EXTRA_TILT = (POUR_EXTRA_TILT_DEG * Math.PI) / 180;

    prevPos = { ...startPos };
    prevRot = { ...tiltedQuat };

    for (let f = 0; f < POUR_FRAMES; f++) {
      const t = easeInOut((f + 1) / POUR_FRAMES);

      const targetPos: Vec3 = {
        x: startPos.x + pourDir.x * POUR_FORWARD_DIST * t,
        y: startPos.y,
        z: startPos.z + pourDir.z * POUR_FORWARD_DIST * t,
      };

      const totalTilt = TILT_ANGLE + POUR_EXTRA_TILT * t;
      const pourTiltQuat = quatFromAxisAngle(tiltAxis, totalTilt);
      const targetRot = normalize(quatMultiply(pourTiltQuat, startQuat));

      stepWithCup(prevPos, prevRot, targetPos, targetRot);
      prevPos = targetPos;
      prevRot = targetRot;
      recordFrame();
    }

    const pourEndPos: Vec3 = { ...prevPos };
    const pourEndTilt = TILT_ANGLE + POUR_EXTRA_TILT;
    const pourEndQuat = normalize(quatMultiply(
      quatFromAxisAngle(tiltAxis, pourEndTilt), startQuat
    ));

    {
      const EXIT_BUFFER = 5;
      const MAX_WAIT = 80;
      const CREEP_PER_FRAME = 0.03;
      let waitFrames = 0;
      let allExitedAt = -1;

      while (waitFrames < MAX_WAIT) {
        waitFrames++;
        if (allExitedAt < 0 && this.allDiceExitedCup()) allExitedAt = waitFrames;
        if (allExitedAt >= 0 && (waitFrames - allExitedAt) >= EXIT_BUFFER) break;

        const creep = waitFrames * CREEP_PER_FRAME;
        const targetPos: Vec3 = {
          x: pourEndPos.x - pourDir.x * creep,
          y: pourEndPos.y,
          z: pourEndPos.z - pourDir.z * creep,
        };

        stepWithCup(prevPos, prevRot, targetPos, pourEndQuat);
        prevPos = targetPos;
        prevRot = pourEndQuat;
        recordFrame();
      }
    }

    this.setCupCollidersEnabled(false);
    this.cupBody.setNextKinematicTranslation({ x: 0, y: -200, z: 0 });
    this.cupBody.setNextKinematicRotation(identityQuat);

    const returnStartPos: Vec3 = { ...prevPos };
    const returnStartQuat: Quat = { ...prevRot };

    for (let f = 0; f < RETURN_FRAMES; f++) {
      const t = easeInOut((f + 1) / RETURN_FRAMES);

      const cupVisualPos: Vec3 = {
        x: returnStartPos.x + (restPos.x - returnStartPos.x) * t,
        y: returnStartPos.y + (restPos.y - returnStartPos.y) * t + 4 * RETURN_ARC_HEIGHT * t * (1 - t),
        z: returnStartPos.z + (restPos.z - returnStartPos.z) * t,
      };

      const cupVisualRot = normalize({
        x: returnStartQuat.x + (identityQuat.x - returnStartQuat.x) * t,
        y: returnStartQuat.y + (identityQuat.y - returnStartQuat.y) * t,
        z: returnStartQuat.z + (identityQuat.z - returnStartQuat.z) * t,
        w: returnStartQuat.w + (identityQuat.w - returnStartQuat.w) * t,
      });

      stepPhysics();
      diceTrajectory.push(this.getDiceStates());
      cupTrajectory.push({ position: cupVisualPos, quaternion: cupVisualRot });
    }

    const maxSettleFrames = 600;
    let calmFrames = 0;
    const requiredCalmFrames = 30;
    const speedThresholdSq = 0.05;

    for (let f = 0; f < maxSettleFrames; f++) {
      stepPhysics();
      diceTrajectory.push(this.getDiceStates());
      cupTrajectory.push({ position: { ...restPos }, quaternion: { ...identityQuat } });

      let allCalm = true;
      for (let i = 0; i < this.diceBodies.length; i++) {
        if (this.keptDice[i]) continue;
        const b = this.diceBodies[i];
        const lv = b.linvel();
        const av = b.angvel();
        if (lengthSq3(lv) > speedThresholdSq || lengthSq3(av) > speedThresholdSq) {
          allCalm = false;
          break;
        }
      }

      if (allCalm) {
        calmFrames++;
      } else {
        calmFrames = 0;
      }

      const allSleeping = this.diceBodies.every((b, i) => this.keptDice[i] || b.isSleeping());
      if (allSleeping || calmFrames >= requiredCalmFrames) {
        break;
      }
    }

    const finalValues = this.getFinalDiceValues();
    this.currentDiceValues = finalValues;
    this.diceInCup = [false, false, false, false, false];

    this.setCupCollidersEnabled(true);

    this.cupBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y, z: CUP_REST_Z });
    this.cupBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    this.cupLidBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y + 4.5, z: CUP_REST_Z });
    this.cupLidBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    this.setBorderWallsEnabled(false);

    this.pendingCupPos = null;
    this.pendingCupQuat = null;

    return { diceTrajectory, cupTrajectory, finalValues };
  }

  private getFinalDiceValues(): number[] {
    const faceNormals = [
      { normal: { x: 0, y: 1, z: 0 }, value: 1 },
      { normal: { x: 0, y: -1, z: 0 }, value: 6 },
      { normal: { x: 1, y: 0, z: 0 }, value: 2 },
      { normal: { x: -1, y: 0, z: 0 }, value: 5 },
      { normal: { x: 0, y: 0, z: 1 }, value: 3 },
      { normal: { x: 0, y: 0, z: -1 }, value: 4 },
    ];
    const upVector = { x: 0, y: 1, z: 0 };

    return this.diceBodies.map(body => {
      let maxValue = 1;
      let maxDot = -Infinity;
      const rot = body.rotation();

      for (const face of faceNormals) {
        const rotatedNormal = rotateVec3ByQuat(face.normal, rot);
        const dot = rotatedNormal.x * upVector.x + rotatedNormal.y * upVector.y + rotatedNormal.z * upVector.z;
        if (dot > maxDot) {
          maxDot = dot;
          maxValue = face.value;
        }
      }
      return maxValue;
    });
  }

  private snapRotationToValue(body: RAPIER.RigidBody, forcedValue?: number): void {
    const faceNormals = [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];
    const worldUp = { x: 0, y: 1, z: 0 };

    let bestFace = faceNormals[0];

    if (forcedValue !== undefined) {
      const targetIndices: Record<number, number> = { 1: 0, 6: 1, 2: 2, 5: 3, 3: 4, 4: 5 };
      bestFace = faceNormals[targetIndices[forcedValue]];
    } else {
      let maxDot = -Infinity;
      const rot = body.rotation();
      for (const localFace of faceNormals) {
        const worldFace = rotateVec3ByQuat(localFace, rot);
        const dot = worldFace.x * worldUp.x + worldFace.y * worldUp.y + worldFace.z * worldUp.z;
        if (dot > maxDot) {
          maxDot = dot;
          bestFace = localFace;
        }
      }
    }

    body.setRotation(quatFromVectors(bestFace, worldUp), true);
  }
}
