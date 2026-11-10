import initJolt from "jolt-physics/wasm-compat";

// The Jolt module and the physics world live on globalThis so that they
// survive Vite's hot reload. A reloaded module would otherwise build a
// second WASM world and leak the first one, and the WASM heap is not big
// enough for many of them.
const S = (globalThis.__drivingSchoolJolt ??= { Jolt: null, api: null, promise: null });

const LAYER_NON_MOVING = 0;
const LAYER_MOVING = 1;

// Cars live in the XZ plane: they translate in X/Z and yaw about Y, but cannot
// lift, sink, pitch or roll. That keeps them flat on the ground while still
// giving real rigid-body collision response.
//
// NOTE: Jolt's EAllowedDOFs_Plane2D is TranslationX|TranslationY|RotationZ --
// that is Jolt's Z-up 2D plane and is wrong for this Y-up world, so the mask
// is built explicitly.
function carDOFs(Jolt) {
  return (
    Jolt.EAllowedDOFs_TranslationX |
    Jolt.EAllowedDOFs_TranslationZ |
    Jolt.EAllowedDOFs_RotationY
  );
}

// embind exposes Jolt's static helpers on the prototype, not on the class.
export function quatFromYaw(Jolt, yaw) {
  return Jolt.Quat.prototype.sRotation(new Jolt.Vec3(0, 1, 0), yaw);
}

// Yaw (rotation about +Y) from a quaternion, wrapped to (-PI, PI].
export function yawFromQuat(qx, qy, qz, qw) {
  const siny = 2 * (qw * qy + qx * qz);
  const cosy = 1 - 2 * (qy * qy + qz * qz);
  return Math.atan2(siny, cosy);
}

export async function getJolt() {
  if (S.Jolt) return S.Jolt;
  if (!S.promise) S.promise = initJolt().then((J) => (S.Jolt = J));
  return S.promise;
}

export async function initPhysics() {
  if (S.api) return S.api;
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

  S.api = {
    Jolt,
    joltInterface,
    physicsSystem,
    bodyInterface,
    bodies: new Set(),
    createCarBody: (opts) => createCarBody(S.api, opts),
    removeCarBody: (body) => removeBody(S.api, body),
  };
  return S.api;
}

export function stepPhysics(api, dt) {
  const d = Math.min(dt, 1 / 30);
  api.joltInterface.Step(d, d > 1 / 55 ? 2 : 1);
}

// Remove every body from the world.
//
// The world itself is kept (the WASM heap cannot host many of them), so this
// is how the app resets on a hot reload and how the headless tests get a
// clean world per scenario.
export function clearBodies(api) {
  if (!api) return;
  for (const body of [...api.bodies]) removeBody(api, body);
  api.bodies.clear();
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
  if (opts.allowedDOFs != null) creation.mAllowedDOFs = opts.allowedDOFs;
  if (opts.motionQuality != null) creation.mMotionQuality = opts.motionQuality;
  if (opts.gravityFactor != null) creation.mGravityFactor = opts.gravityFactor;
  if (opts.mass != null) {
    // Use the requested mass but let Jolt derive the inertia tensor from the
    // shape, so inertia stays consistent with the collider geometry.
    creation.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    creation.mMassPropertiesOverride.mMass = opts.mass;
  }
  const body = bodyInterface.CreateBody(creation);
  bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);
  Jolt.destroy(creation);
  api.bodies.add(body);
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

// A car is a dynamic box body locked to the XZ plane (see carDOFs).
export function createCarBody(
  api,
  { x = 0, z = 0, heading = Math.PI, w = 1.1, h = 0.45, l = 2.2, mass = 1200, restitution = 0.05, friction = 0.4 } = {}
) {
  const { Jolt } = api;
  const shape = new Jolt.BoxShapeSettings(new Jolt.Vec3(w / 2, h / 2, l / 2), 0.05);
  return addBody(
    api,
    shape,
    { x, y: h / 2 + 0.35, z },
    quatFromYaw(Jolt, heading),
    Jolt.EMotionType_Dynamic,
    LAYER_MOVING,
    {
      friction,
      restitution,
      linearDamping: 0,
      // No angular damping: the yaw controller (src/drive/vehicle.js) already
      // damps yaw rate back to its target, and Jolt's damping here would fight
      // it, leaving a steady-state yaw-rate error.
      angularDamping: 0,
      allowSleep: false,
      allowedDOFs: carDOFs(Jolt),
      motionQuality: Jolt.EMotionQuality_LinearCast,
      gravityFactor: 0,
      mass,
    }
  );
}

export function removeBody(api, body) {
  if (!api || !body) return;
  const { bodyInterface } = api;
  const id = body.GetID();
  bodyInterface.RemoveBody(id);
  bodyInterface.DestroyBody(id);
  api.bodies.delete(body);
}

// Full kinematic state of a car body, in the same convention the rest of the
// sandbox uses: heading is yaw, forward = (sin h, cos h), and `speed` is the
// signed forward speed (negative when reversing).
export function readBodyState(api, body) {
  const { bodyInterface } = api;
  const id = body.GetID();
  const p = bodyInterface.GetPosition(id);
  const r = bodyInterface.GetRotation(id);
  const v = bodyInterface.GetLinearVelocity(id);
  const a = bodyInterface.GetAngularVelocity(id);

  const heading = yawFromQuat(r.GetX(), r.GetY(), r.GetZ(), r.GetW());
  const vx = v.GetX();
  const vz = v.GetZ();
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);

  return {
    x: p.GetX(),
    y: p.GetY(),
    z: p.GetZ(),
    heading,
    speed: vx * sinH + vz * cosH, // signed forward speed
    vLat: vx * cosH - vz * sinH, // sideways speed
    vx,
    vz,
    yawRate: a.GetY(),
  };
}

// Inertia about the yaw axis, read from the body so the control law always
// matches the actual collider.
export function yawInertia(api, body) {
  const inv = api.bodyInterface.GetInverseInertia(body.GetID());
  const iyy = inv.GetColumn3(1).GetY();
  return iyy > 1e-9 ? 1 / iyy : 605;
}

// Apply a horizontal force (world XZ) to a body for the next physics step.
// Forces are consumed by the step, so they must be re-applied every frame.
export function addForce(api, body, fx, fz) {
  const { Jolt, bodyInterface } = api;
  bodyInterface.AddForce(body.GetID(), new Jolt.Vec3(fx, 0, fz), Jolt.EActivation_Activate);
  bodyInterface.ActivateBody(body.GetID());
}

// Apply a torque about the yaw axis (world Y).
export function addTorque(api, body, ty) {
  const { Jolt, bodyInterface } = api;
  bodyInterface.AddTorque(body.GetID(), new Jolt.Vec3(0, ty, 0), Jolt.EActivation_Activate);
  bodyInterface.ActivateBody(body.GetID());
}
