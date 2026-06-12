import { PhysicsWorld, PourResult } from './PhysicsWorld';

let engine: PhysicsWorld | null = null;
let initPromise: Promise<PhysicsWorld> | null = null;

export async function initPhysicsEngine(): Promise<PhysicsWorld> {
  if (engine) return engine;
  if (!initPromise) {
    initPromise = PhysicsWorld.create().then(pw => {
      engine = pw;
      return pw;
    });
  }
  return initPromise;
}

export function getPhysicsEngine(): PhysicsWorld | null {
  return engine;
}

type Listener<T> = (data: T) => void;
let pourListeners: Listener<PourResult>[] = [];

export function onPourResult(cb: Listener<PourResult>): () => void {
  pourListeners.push(cb);
  return () => { pourListeners = pourListeners.filter(c => c !== cb); };
}

export function emitPourResult(result: PourResult): void {
  pourListeners.forEach(cb => cb(result));
}
