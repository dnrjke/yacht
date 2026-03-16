import * as CANNON from 'cannon-es';
import { YACHT_CONSTANTS } from '@yacht/core';

export class PhysicsWorld {
  public world: CANNON.World;
  public diceBodies: CANNON.Body[] = [];
  public cupBody: CANNON.Body;

  // Dice dimensions (approximate 1 unit cube for now)
  private diceShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
  private diceMass = 1; // 1kg
  
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });

    // Materials
    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(
      defaultMaterial,
      defaultMaterial,
      { friction: 0.1, restitution: 0.5 }
    );
    this.world.addContactMaterial(defaultContactMaterial);

    // Floor
    const floorShape = new CANNON.Plane();
    const floorBody = new CANNON.Body({ mass: 0, material: defaultMaterial }); // Mass 0 makes it static
    floorBody.addShape(floorShape);
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Rotate to layout flat
    this.world.addBody(floorBody);

    // Initialize Dice
    for (let i = 0; i < YACHT_CONSTANTS.DICE_COUNT; i++) {
      const dice = new CANNON.Body({
        mass: this.diceMass,
        shape: this.diceShape,
        material: defaultMaterial,
        position: new CANNON.Vec3((Math.random() - 0.5) * 2, 5 + i * 2, (Math.random() - 0.5) * 2)
      });
      this.world.addBody(dice);
      this.diceBodies.push(dice);
    }

    // Initialize Cup (Kinematic, meaning we manually control its position from client input)
    // For now, represent cup as an open box or a cylinder. A cylinder is easier.
    this.cupBody = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(0, 5, 0)
    });
    // Add walls and base to the cup body so dice don't fall out (simplified for now)
    const cupBaseListShape = new CANNON.Cylinder(2, 2, 0.5, 16);
    this.cupBody.addShape(cupBaseListShape, new CANNON.Vec3(0, -2, 0));
    // Ideally we add more shapes to create hollow cylinder, but starting simple
    this.world.addBody(this.cupBody);
  }

  step(dt: number = 1 / 60) {
    this.world.step(dt);
  }

  updateCupTransform(position: {x: number, y: number, z: number}, quaternion: {x: number, y: number, z: number, w: number}) {
    this.cupBody.position.set(position.x, position.y, position.z);
    this.cupBody.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  }

  getDiceStates() {
    return this.diceBodies.map(body => ({
      position: { x: body.position.x, y: body.position.y, z: body.position.z },
      quaternion: { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w }
    }));
  }

  // Pre-calculate the entire roll deterministically
  simulateRoll(throwVelocity: {x: number, y: number, z: number}, throwAngular: {x: number, y: number, z: number}) {
    // 1. Give dice impulse
    this.diceBodies.forEach(dice => {
      // Small random variations per dice so they don't stick together perfectly
      const vOffset = new CANNON.Vec3((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2);
      dice.velocity.set(throwVelocity.x + vOffset.x, throwVelocity.y + vOffset.y, throwVelocity.z + vOffset.z);
      dice.angularVelocity.set(throwAngular.x + vOffset.x, throwAngular.y + vOffset.y, throwAngular.z + vOffset.z);
      dice.wakeUp(); // ensure they aren't sleeping
    });

    const trajectory = [];
    const maxSteps = 60 * 10; // 10 seconds timeout max
    let steps = 0;
    
    // 2. Loop until all dice are asleep or timeout
    while (steps < maxSteps) {
      this.world.step(1 / 60);
      trajectory.push(this.getDiceStates());
      
      const allSleeping = this.diceBodies.every(b => b.sleepState === CANNON.Body.SLEEPING);
      if (allSleeping) break;
      
      steps++;
    }

    // 3. Determine final faces (1-6) based on quaternion (placeholder logic for now)
    const finalValues = this.diceBodies.map(body => {
      // In a real implementation, we dot-product the face normals with Up vector
      // For now, random 1-6 deterministically chosen at the end of the roll simulation
      return Math.floor(Math.random() * 6) + 1; 
    });

    return { trajectory, finalValues };
  }
}
