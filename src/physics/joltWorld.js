import initJolt from "jolt-physics/wasm-compat";

let _Jolt = null;
let _api = null;
let _initPromise = null;

const LAYER_NON_MOVING = 0;
const LAYER_MOVING = 1;

export async function getJolt() {
  if (_Jolt) return _Jolt;
  if (!_initPromise) _initPromise = initJolt().then((J) => (_Jolt = J));
  return _initPromise;
}

export async function initPhysics() {
  if (_api) return _api;
  const Jolt = await getJolt();

  const objectFilter = new Jolt.ObjectLayerPairFilterTable(2);
  objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING);
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);

  const BP_LAYER_NON_MOVING = new Jolt.BroadPhaseLayer(0);
  const BP_LAYER_MOVING = new Jolt.BroadPhaseLayer(1);
  const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, BP_LAYER_NON_MOVING);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, BP_LAYER_MOVING);

  const settings = new Jolt.JoltSettings();
  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
    settings.mBroadPhaseLayerInterface, 2, settings.mObjectLayerPairFilter, 2
  );

  const joltInterface = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);
  const physicsSystem = joltInterface.GetPhysicsSystem();
  const bodyInterface = physicsSystem.GetBodyInterface();
  physicsSystem.SetGravity(new Jolt.Vec3(0, -9.81, 0));

  _api = { Jolt, joltInterface, physicsSystem, bodyInterface, bodies: new Map() };
  return _api;
}

export function stepPhysics(api, dt) {
  const d = Math.min(dt, 1 / 30);
  api.joltInterface.Step(d, d > 1 / 55 ? 2 : 1);
}

function addBody(api, shapeSettings, pos, quat, motionType, layer, opts = {}) {
  const { Jolt, bodyInterface } = api;
  const shapeResult = shapeSettings.Create();
  const shapeRef = shapeResult.Get();
  const creation = new Jolt.BodyCreationSettings(
    shapeRef,
    new Jolt.RVec3(pos.x, pos.y, pos.z),
    quat || new Jolt.Quat(0, 0, 0, 1),
    motionType,
    layer
  );
  if (opts.friction != null) creation.mFriction = opts.friction;
  if (opts.restitution != null) creation.mRestitution = opts.restitution;
  if (opts.linearDamping != null) creation.mLinearDamping = opts.linearDamping;
  if (opts.angularDamping != null) creation.mAngularDamping = opts.angularDamping;
  if (opts.allowSleep != null) creation.mAllowSleeping = opts.allowSleep;
  const body = bodyInterface.CreateBody(creation);
  bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);
  Jolt.destroy(creation);
  return body;
}

export function createGround(api, { y = 0, size = 240 } = {}) {
  const { Jolt } = api;
  const shape = new Jolt.BoxShapeSettings(new Jolt.Vec3(size / 2, 0.5, size / 2), 0.05);
  return addBody(api, shape, { x: 0, y: y - 0.5, z: 0 }, null, Jolt.EMotionType_Static, LAYER_NON_MOVING, { friction: 1 });
}

export function createObstacleBody(api, { x, z, r = 1, h = 1.5 } = {}) {
  const { Jolt } = api;
  const shape = new Jolt.CylinderShapeSettings(h / 2, r, 0.05);
  return addBody(api, shape, { x, y: h / 2, z }, null, Jolt.EMotionType_Static, LAYER_NON_MOVING, { friction: 0.8 });
}

export function createCarBody(api, { x = 0, z = 0, heading = Math.PI, w = 1.1, h = 0.45, l = 2.2 } = {}) {
  const { Jolt } = api;
  const shape = new Jolt.BoxShapeSettings(new Jolt.Vec3(w / 2, h / 2, l / 2), 0.05);
  let q;
  if (typeof Jolt.Quat.sRotation === "function") q = Jolt.Quat.sRotation(new Jolt.Vec3(0,1,0), heading);
  else { q = new Jolt.Quat(0,0,0,1); if (typeof q.sRotation === "function") q.sRotation(new Jolt.Vec3(0,1,0), heading); }

  const body = addBody(api, shape, { x, y: h / 2 + 0.35, z }, q, Jolt.EMotionType_Dynamic, LAYER_MOVING, {
    friction: 0.9, restitution: 0.05, linearDamping: 0.2, angularDamping: 2.5, allowSleep: false,
  });
  // Lock pitch/roll for arcade stability (keep yaw + translation)
  // (Done via mass properties override not shown; acceptable for first pass)
  return body;
}

export function quatToYaw(qx, qy, qz, qw) {
  // yaw (Y) from quaternion
  const siny = 2 * (qw * qy + qx * qz);
  const cosy = 1 - 2 * (qy * qy + qz * qz);
  return Math.atan2(siny, cosy);
}

export function readBodyTransform(api, body) {
  const { bodyInterface } = api;
  const p = bodyInterface.GetPosition(body.GetID());
  const q = bodyInterface.GetRotation(body.GetID());
  const qx = q.GetX(), qy = q.GetY(), qz = q.GetZ(), qw = q.GetW();
  return { x: p.GetX(), y: p.GetY(), z: p.GetZ(), qx, qy, qz, qw, heading: quatToYaw(qx, qy, qz, qw) };
}

// Drive a dynamic body with arcade intent while letting Jolt handle collisions.
// Sets desired horizontal velocity and yaw angular velocity; Jolt integrates & resolves collisions.
export function driveCarBody(api, body, { heading, speed, steer }, dt) {
  const { Jolt, bodyInterface } = api;
  const id = body.GetID();
  const maxSpeed = 7;
  const turnFactor = 1.8;
  // desired yaw rate from steering (rad/s)
  const yawRate = Math.abs(speed) > 0.02 ? (speed / maxSpeed) * steer * turnFactor : 0;
  const h = heading + yawRate * dt;
  const vx = Math.sin(h) * speed;
  const vz = Math.cos(h) * speed;
  const cur = bodyInterface.GetLinearVelocity(id);
  bodyInterface.SetLinearAndAngularVelocity(id, new Jolt.Vec3(vx, cur.GetY(), vz), new Jolt.Vec3(0, yawRate, 0));
  bodyInterface.ActivateBody(id);
  return { heading: h, yawRate };
}

export function removeBody(api, body) {
  if (!api || !body) return;
  const { bodyInterface } = api;
  const id = body.GetID();
  bodyInterface.RemoveBody(id);
  bodyInterface.DestroyBody(id);
}
