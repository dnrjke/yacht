import RAPIER from '@dimforge/rapier3d-compat';
import { YACHT_CONSTANTS, BOARD_CONSTANTS, CUP_DICE_OFFSETS, getTraySlotPosition } from '@yacht/core';

export interface PourResult {
  diceTrajectory: Array<Array<{ position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }>>;
  cupTrajectory: Array<{ position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } }>;
  finalValues: number[];
}

// ─── Math Utilities (replace cannon-es Vec3/Quaternion methods) ───

/** Rotate a vector by a quaternion (cannon-es quat.vmult replacement) */
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

/** Quaternion that rotates `from` to `to` (cannon-es Quaternion.setFromVectors replacement) */
function quatFromVectors(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number }
): { x: number; y: number; z: number; w: number } {
  const cx = from.y * to.z - from.z * to.y;
  const cy = from.z * to.x - from.x * to.z;
  const cz = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y + from.z * to.z;
  const w = 1 + dot;

  // Anti-parallel guard: when from ≈ -to, w ≈ 0 and cross ≈ 0
  // Must match Three.js Quaternion.setFromUnitVectors anti-parallel handling
  if (w < 1e-6) {
    if (Math.abs(from.x) > Math.abs(from.z)) {
      return normalize({ x: -from.y, y: from.x, z: 0, w: 0 });
    }
    return normalize({ x: 0, y: -from.z, z: from.y, w: 0 });
  }

  return normalize({ x: cx, y: cy, z: cz, w });
}

/** Y-axis rotation quaternion (cup wall segment placement) */
function quatFromAxisAngle(
  axis: { x: number; y: number; z: number },
  angle: number
): { x: number; y: number; z: number; w: number } {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

/** Multiply two quaternions: a * b */
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

/** Quaternion from Euler angles (ZYX order) */
function quatFromEuler(x: number, y: number, z: number): { x: number; y: number; z: number; w: number } {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
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

/** Quaternion inverse (conjugate — valid for unit quaternions) */
function quatInverse(q: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

// ─── PhysicsWorld ───

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
  private subStepDt = 1 / (60 * 4); // 1/240 s — preserving sub-stepping for contact stability

  // Pending cup transform — applied incrementally across sub-steps
  private pendingCupPos: { x: number; y: number; z: number } | null = null;
  private pendingCupQuat: { x: number; y: number; z: number; w: number } | null = null;

  // Phase 1: border wall colliders for toggling
  private borderWallColliders: RAPIER.Collider[] = [];
  private wallsEnabled = false; // start OFF — cup is outside board at rest

  /** Async factory — call RAPIER.init() once then construct */
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  private constructor() {
    // ── World ──
    this.world = new RAPIER.World({ x: 0, y: -9.82 * 4.0, z: 0 });
    this.world.timestep = this.subStepDt;

    // Solver iterations (Rapier default 4, raise for contact quality)
    this.world.integrationParameters.numSolverIterations = 16;

    // ── Floor (thin cuboid) ──
    const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const floorBody = this.world.createRigidBody(floorDesc);
    const floorCollider = RAPIER.ColliderDesc.cuboid(50, 0.5, 50)
      .setFriction(0.6)
      .setRestitution(0.1);
    this.world.createCollider(floorCollider, floorBody);

    // ── Border Walls + Ceiling ──
    const { BOARD_SIZE, WALL_THICKNESS, PHYSICS_WALL_HEIGHT, CUP_REST_X, CUP_REST_Y, CUP_REST_Z } = BOARD_CONSTANTS;
    const halfBoard = BOARD_SIZE / 2;
    const hw = WALL_THICKNESS / 2;
    const totalWidth = BOARD_SIZE + WALL_THICKNESS * 2;
    const wallHalfH = PHYSICS_WALL_HEIGHT / 2;
    const wallCenterY = PHYSICS_WALL_HEIGHT / 2;

    const wallDesc = RAPIER.RigidBodyDesc.fixed();
    const wallBody = this.world.createRigidBody(wallDesc);

    // Top & Bottom walls (-z, +z)
    const tbCollider = () => RAPIER.ColliderDesc.cuboid(totalWidth / 2, wallHalfH, hw)
      .setFriction(0.5).setRestitution(0.1);
    this.borderWallColliders.push(
      this.world.createCollider(tbCollider().setTranslation(0, wallCenterY, -(halfBoard + hw)), wallBody),
      this.world.createCollider(tbCollider().setTranslation(0, wallCenterY, (halfBoard + hw)), wallBody),
    );

    // Left & Right walls (-x, +x)
    const lrCollider = () => RAPIER.ColliderDesc.cuboid(hw, wallHalfH, halfBoard)
      .setFriction(0.5).setRestitution(0.1);
    this.borderWallColliders.push(
      this.world.createCollider(lrCollider().setTranslation(-(halfBoard + hw), wallCenterY, 0), wallBody),
      this.world.createCollider(lrCollider().setTranslation((halfBoard + hw), wallCenterY, 0), wallBody),
    );

    // Start with walls OFF — cup rests outside the board
    for (const c of this.borderWallColliders) { c.setEnabled(false); }

    // Ceiling
    const ceilingHalfSize = (BOARD_SIZE + WALL_THICKNESS * 2) / 2 + 10;
    const ceilingCollider = RAPIER.ColliderDesc.cuboid(ceilingHalfSize, 0.5, ceilingHalfSize)
      .setTranslation(0, PHYSICS_WALL_HEIGHT, 0);
    this.world.createCollider(ceilingCollider, wallBody);

    // ── Dice (Dynamic + CCD) ──
    for (let i = 0; i < YACHT_CONSTANTS.DICE_COUNT; i++) {
      const diceDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(CUP_REST_X, CUP_REST_Y + i, CUP_REST_Z)
        .setCcdEnabled(true)
        .setSoftCcdPrediction(2.0)  // predict 2 units ahead — dice full width for tunneling prevention
        .setCanSleep(true)
        .setLinearDamping(0.1)    // low damping — dice roll energetically after landing
        .setAngularDamping(0.2);  // allow natural tumbling, mild spin decay
      const diceBody = this.world.createRigidBody(diceDesc);

      const diceCollider = RAPIER.ColliderDesc.cuboid(1.0, 1.0, 1.0)
        .setMass(this.diceMass)
        .setFriction(0.5)         // raised from 0.3 — more surface drag for heavy feel
        .setRestitution(0.15);    // lowered from 0.3 — less bouncy, more thud
      this.world.createCollider(diceCollider, diceBody);

      this.diceBodies.push(diceBody);
    }

    // ── Cup (KinematicPositionBased) ──
    const cupDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(CUP_REST_X, CUP_REST_Y, CUP_REST_Z);
    this.cupBody = this.world.createRigidBody(cupDesc);

    // Cup base — shallow concave bowl approximated by ring segments.
    // A flat center disc plus tilted annular rings that rise toward the edge,
    // creating a gentle bowl shape (depth ~0.6 units) so dice converge to center.
    const bowlBaseY = -4.0;
    const bowlDepth = 0.6;       // how much lower the center is vs the rim — subtle
    const bowlRings = 3;         // number of concentric rings
    const bowlInnerR = 0;        // center
    const bowlOuterR = 4.0;      // matches cup inner radius
    const ringWidth = bowlOuterR / bowlRings;

    for (let r = 0; r < bowlRings; r++) {
      const rInner = bowlInnerR + r * ringWidth;
      const rOuter = rInner + ringWidth;
      const rMid = (rInner + rOuter) / 2;

      // Height rises parabolically from center to rim
      const tNorm = rMid / bowlOuterR;                    // 0..1
      const ringY = bowlBaseY - bowlDepth * (1 - tNorm * tNorm); // parabolic rise
      // Tilt angle: derivative of parabola → slope at this radius
      const slopeAngle = Math.atan2(bowlDepth * 2 * tNorm, bowlOuterR);

      // Use 16 box segments per ring arranged radially (matches wall segment count)
      const segs = 16;
      const segAngle = (2 * Math.PI) / segs;
      const segArc = 2 * rMid * Math.tan(segAngle / 2);
      const segThickness = 1.0;  // vertical thickness — thicker to prevent dice tunneling

      for (let s = 0; s < segs; s++) {
        const angle = s * segAngle;
        const sx = Math.sin(angle) * rMid;
        const sz = Math.cos(angle) * rMid;

        // Tilt outward: rotate around tangent direction (perpendicular to radial)
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

    // Bowl bumps — small nubs on the bowl floor to perturb dice during shaking.
    // Real dice cups have textured interiors for this exact purpose.
    const bumpHeight = 0.35;
    const bumpRadius = 0.3;
    // Central bump
    const centralBump = RAPIER.ColliderDesc.cuboid(bumpRadius, bumpHeight / 2, bumpRadius)
      .setTranslation(0, bowlBaseY - bowlDepth + bumpHeight / 2, 0)
      .setFriction(0.4)
      .setRestitution(0.2);
    this.world.createCollider(centralBump, this.cupBody);
    // Ring of 5 bumps at mid-radius (staggered so dice always hit one)
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

    // Cup walls (16 box segments — doubled from 8 for tighter seam overlap)
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

    // Safety disc under the bowl — flush with thickened bowl bottom to eliminate trap gap
    // Bowl center ring bottom ≈ bowlBaseY - bowlDepth - 0.5 (half of 1.0 thickness)
    const safetyDiscHalfH = 0.2;
    const safetyDiscCollider = RAPIER.ColliderDesc.cylinder(safetyDiscHalfH, bowlOuterR - 0.5)
      .setTranslation(0, bowlBaseY - bowlDepth - 0.5 - safetyDiscHalfH, 0)
      .setFriction(0.5)
      .setRestitution(0.1);
    this.world.createCollider(safetyDiscCollider, this.cupBody);

    // ── Cup Lid (KinematicPositionBased) ──
    const lidRadius = innerRadius + wallThickness;
    const lidDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(CUP_REST_X, CUP_REST_Y + wallHeight / 2 + 0.5, CUP_REST_Z);
    this.cupLidBody = this.world.createRigidBody(lidDesc);

    const lidCollider = RAPIER.ColliderDesc.cylinder(0.5, lidRadius)
      .setFriction(0.5)
      .setRestitution(0.1);
    this.world.createCollider(lidCollider, this.cupLidBody);

    // Spawn dice inside cup
    this.spawnDiceInCup();
  }

  // ─── Public Methods ───

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

  spawnNonKeptDiceInCup(keptIndices: (number | null)[]): void {
    const keptSet = new Set(keptIndices.filter(i => i !== null) as number[]);
    this.keptDice = this.diceBodies.map((_, i) => keptSet.has(i));
    this.diceInCup = this.diceBodies.map((_, i) => !keptSet.has(i));

    const cupPos = this.cupBody.translation();

    // 1. Position kept dice in tray slots
    keptIndices.forEach((dieIdx, slotIdx) => {
      if (dieIdx === null) return;
      const dice = this.diceBodies[dieIdx];
      if (!dice) return;

      const trayPos = getTraySlotPosition(slotIdx);
      dice.setTranslation(trayPos, true);
      dice.setLinvel({ x: 0, y: 0, z: 0 }, true);
      dice.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.snapRotationToValue(dice, this.currentDiceValues[dieIdx]);
      // Freeze kept dice
      dice.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    });

    // 2. Position non-kept dice inside cup
    let cupSlot = 0;
    this.diceBodies.forEach((dice, i) => {
      if (!keptSet.has(i)) {
        dice.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

        const off = CUP_DICE_OFFSETS[cupSlot % CUP_DICE_OFFSETS.length];
        dice.setTranslation({ x: cupPos.x + off.x, y: cupPos.y + off.y, z: cupPos.z + off.z }, true);
        dice.setLinvel({ x: 0, y: 0, z: 0 }, true);
        dice.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.snapRotationToValue(dice, this.currentDiceValues[i]);

        // Lock rotation to prevent face-change while in cup before roll
        dice.lockRotations(true, true);

        dice.wakeUp();
        cupSlot++;
      }
    });
  }

  allDiceReadyToPour(): boolean {
    return this.diceBodies.every((_, i) => this.diceInCup[i] || this.keptDice[i]);
  }

  // ── Cup geometry constants for dice-exit detection ──
  // Must match the cup collider construction values above.
  private static readonly CUP_INNER_RADIUS = 4.0;
  private static readonly CUP_BOWL_BASE_Y = -4.0;
  private static readonly CUP_WALL_HALF_HEIGHT = 4.0; // wallHeight(8) / 2

  /** Check if a single non-kept die is still inside the cup volume (local cylinder). */
  private isDiceInsideCup(diceIndex: number): boolean {
    const cupPos = this.cupBody.translation();
    const cupRot = this.cupBody.rotation();
    const dicePos = this.diceBodies[diceIndex].translation();

    // Relative position in world space
    const rel = { x: dicePos.x - cupPos.x, y: dicePos.y - cupPos.y, z: dicePos.z - cupPos.z };

    // Transform to cup-local space
    const local = rotateVec3ByQuat(rel, quatInverse(cupRot));

    // Cylinder check with margin (dice half-size ≈ 1.0)
    const margin = 1.0;
    const horizDist = Math.sqrt(local.x * local.x + local.z * local.z);
    return horizDist < PhysicsWorld.CUP_INNER_RADIUS + margin
      && local.y > PhysicsWorld.CUP_BOWL_BASE_Y - margin
      && local.y < PhysicsWorld.CUP_WALL_HALF_HEIGHT + margin;
  }

  /** Check if all non-kept dice have exited the cup. */
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
    // Defer actual movement — step() will interpolate across sub-steps
    this.pendingCupPos = { x: position.x, y: position.y, z: position.z };
    this.pendingCupQuat = { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };

    // Wake up dice in cup & unlock rotations so they react to cup movement
    for (let i = 0; i < this.diceBodies.length; i++) {
      if (this.diceInCup[i]) {
        const d = this.diceBodies[i];
        d.lockRotations(false, true);
        d.wakeUp();
      }
    }
  }

  step(): void {
    if (this.pendingCupPos && this.pendingCupQuat) {
      // Interpolate cup/lid movement across sub-steps to distribute impulse energy.
      // Without this, the full velocity is applied in the 1st sub-step only,
      // causing dice to receive 4x the intended impulse.
      const prevPos = this.cupBody.translation();
      const prevRot = this.cupBody.rotation();
      const targetPos = this.pendingCupPos;
      const targetRot = this.pendingCupQuat;

      for (let i = 0; i < this.subSteps; i++) {
        const t = (i + 1) / this.subSteps;

        // Lerp position
        const interpPos = {
          x: prevPos.x + (targetPos.x - prevPos.x) * t,
          y: prevPos.y + (targetPos.y - prevPos.y) * t,
          z: prevPos.z + (targetPos.z - prevPos.z) * t,
        };
        // Nlerp quaternion (sufficient for small inter-frame rotations)
        const interpQuat = normalize({
          x: prevRot.x + (targetRot.x - prevRot.x) * t,
          y: prevRot.y + (targetRot.y - prevRot.y) * t,
          z: prevRot.z + (targetRot.z - prevRot.z) * t,
          w: prevRot.w + (targetRot.w - prevRot.w) * t,
        });

        this.cupBody.setNextKinematicTranslation(interpPos);
        this.cupBody.setNextKinematicRotation(interpQuat);

        // Lid follows cup (offset = wallHeight/2 + lidHalfHeight = 4.0 + 0.5)
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
    } else {
      // No cup movement pending — just step (e.g. dice settling after pour)
      for (let i = 0; i < this.subSteps; i++) {
        this.world.step();
      }
    }
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

    // stepPhysics: no cup movement (stationary cup or settle phases)
    const stepPhysics = () => {
      for (let _s = 0; _s < this.subSteps; _s++) { this.world.step(); }
    };

    // stepWithCup: interpolate cup position/rotation across sub-steps.
    // Rapier's setNextKinematicTranslation only moves the body for ONE step;
    // without interpolation, sub-steps 2–4 have zero cup velocity → dice
    // receive only 1/4 of the intended contact force.
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

    // ── Boundary correction ──
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

    // Set cup to provided position
    this.cupBody.setNextKinematicTranslation(cupPosition);
    this.cupBody.setNextKinematicRotation(cupQuaternion);

    // Correction slide (walls OFF, lid ON — dice safe inside cup)
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

        // Lid follows cup during correction
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

    // Walls ON before tilt (dice about to be released onto board)
    this.setBorderWallsEnabled(true);

    // Remove lid (move far away) — after correction, before tilt
    this.cupLidBody.setNextKinematicTranslation({ x: 0, y: -100, z: 0 });

    // Ensure non-kept dice are awake and free to rotate
    this.diceBodies.forEach((d, i) => {
      if (!this.keptDice[i]) {
        d.lockRotations(false, true);
        d.wakeUp();
      }
    });

    // ── Pour motion — 4 distinct phases ──
    const startPos = needsCorrection ? clampedPosition : { x: cupPosition.x, y: cupPosition.y, z: cupPosition.z };
    const startQuat = { x: cupQuaternion.x, y: cupQuaternion.y, z: cupQuaternion.z, w: cupQuaternion.w };
    const restPos = { x: CUP_REST_X, y: CUP_REST_Y, z: CUP_REST_Z };
    const identityQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };

    // ── Pour timing constants ──
    // Adjust these to tune the feel without touching the logic.

    // Phase 1 — Tilt (pure rotation, no vertical movement)
    const TILT_FRAMES = 35;
    const TILT_ANGLE = (130 * Math.PI) / 180;         // 130° — well past horizontal

    // Phase 2 — Pour tip (gentle forward nudge while tilted, dice slide out)
    const POUR_FRAMES = 14;                            // unhurried pour
    const POUR_FORWARD_DIST = 3;                       // small forward nudge toward board
    const POUR_EXTRA_TILT_DEG = 10;                    // 130° → 140°

    // Phase 3 — Return arc (directly from pour position back to rest)
    const RETURN_FRAMES = 40;
    const RETURN_ARC_HEIGHT = 5;

    // ── Shared helpers ──

    // Adaptive tilt direction: cup → board center
    const dx = 0 - startPos.x;
    const dz = 0 - startPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const tiltAxis = dist > 0.1
      ? { x: dz / dist, y: 0, z: -dx / dist }
      : { x: 0, y: 0, z: 1 };

    const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

    // ── Phase 1: Tilt (pure rotation) ──
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

    // Fully tilted quaternion — used as reference for subsequent phases
    const tiltedQuat = normalize(quatMultiply(
      quatFromAxisAngle(tiltAxis, TILT_ANGLE), startQuat
    ));

    // ── Phase 2: Pour tip — brief forward nudge, dice begin sliding out ──
    const pourDir = dist > 0.1 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 0 };
    const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
    const POUR_EXTRA_TILT = (POUR_EXTRA_TILT_DEG * Math.PI) / 180;

    prevPos = { ...startPos };
    prevRot = { ...tiltedQuat };

    for (let f = 0; f < POUR_FRAMES; f++) {
      const t = easeInOut((f + 1) / POUR_FRAMES);

      const targetPos: Vec3 = {
        x: startPos.x + pourDir.x * POUR_FORWARD_DIST * t,
        y: startPos.y,                                   // stay level — no dip
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

    // ── Adaptive wait: hold pour position until all dice exit ──
    // Cup barely creeps backward — feels continuous, not a pause.
    const pourEndPos: Vec3 = { ...prevPos };
    const pourEndTilt = TILT_ANGLE + POUR_EXTRA_TILT;
    const pourEndQuat = normalize(quatMultiply(
      quatFromAxisAngle(tiltAxis, pourEndTilt), startQuat
    ));

    {
      const EXIT_BUFFER = 5;
      const MAX_WAIT = 80;
      const CREEP_PER_FRAME = 0.03;                      // tiny backward drift per frame
      let waitFrames = 0;
      let allExitedAt = -1;

      while (waitFrames < MAX_WAIT) {
        waitFrames++;
        if (allExitedAt < 0 && this.allDiceExitedCup()) allExitedAt = waitFrames;
        if (allExitedAt >= 0 && (waitFrames - allExitedAt) >= EXIT_BUFFER) break;

        // Barely creep backward so the cup isn't frozen
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

    // ── Phase 3: Return arc — from pour position directly to rest ──
    // Cup's pouring job is done — disable collision so it doesn't
    // knock dice on the board while flying back to rest position.
    this.setCupCollidersEnabled(false);

    const returnStartPos: Vec3 = { ...prevPos };
    const returnStartQuat: Quat = { ...prevRot };

    for (let f = 0; f < RETURN_FRAMES; f++) {
      const t = easeInOut((f + 1) / RETURN_FRAMES);

      const targetPos: Vec3 = {
        x: returnStartPos.x + (restPos.x - returnStartPos.x) * t,
        y: returnStartPos.y + (restPos.y - returnStartPos.y) * t + 4 * RETURN_ARC_HEIGHT * t * (1 - t),
        z: returnStartPos.z + (restPos.z - returnStartPos.z) * t,
      };

      const targetRot = normalize({
        x: returnStartQuat.x + (identityQuat.x - returnStartQuat.x) * t,
        y: returnStartQuat.y + (identityQuat.y - returnStartQuat.y) * t,
        z: returnStartQuat.z + (identityQuat.z - returnStartQuat.z) * t,
        w: returnStartQuat.w + (identityQuat.w - returnStartQuat.w) * t,
      });

      stepWithCup(prevPos, prevRot, targetPos, targetRot);
      prevPos = targetPos;
      prevRot = targetRot;
      recordFrame();
    }

    // Cup colliders stay disabled through settle phase to avoid
    // interfering with dice that may bounce near the rest position.

    // ── Settle: wait for dice to stop ──
    const maxSettleFrames = 600;
    let calmFrames = 0;
    const requiredCalmFrames = 30;
    const speedThresholdSq = 0.05;

    for (let f = 0; f < maxSettleFrames; f++) {
      stepPhysics();
      recordFrame();

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

    // Re-enable cup colliders now that settle is complete
    this.setCupCollidersEnabled(true);

    // Reset cup and lid to rest position, walls OFF for next shake
    this.cupBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y, z: CUP_REST_Z });
    this.cupBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    this.cupLidBody.setNextKinematicTranslation({ x: CUP_REST_X, y: CUP_REST_Y + 4.5, z: CUP_REST_Z });
    this.cupLidBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    this.setBorderWallsEnabled(false);

    return { diceTrajectory, cupTrajectory, finalValues };
  }

  // ─── Private Methods ───

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
      { x: 0, y: 1, z: 0 },   // 1
      { x: 0, y: -1, z: 0 },  // 6
      { x: 1, y: 0, z: 0 },   // 2
      { x: -1, y: 0, z: 0 },  // 5
      { x: 0, y: 0, z: 1 },   // 3
      { x: 0, y: 0, z: -1 },  // 4
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
