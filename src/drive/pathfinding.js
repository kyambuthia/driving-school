// Simple grid A* over XZ for static obstacle circles. Returns [{x,z}, ...] or null.
function key(ix, iz) { return ix + "," + iz; }

export function astar({ start, goal, obstacles = [], bounds = { minX: -40, maxX: 40, minZ: -50, maxZ: 10 }, cellSize = 1.0, margin = 1.4, maxNodes = 8000 } = {}) {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cellSize);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cellSize);
  const toCell = (x, z) => ({
    ix: Math.max(0, Math.min(cols - 1, Math.floor((x - bounds.minX) / cellSize))),
    iz: Math.max(0, Math.min(rows - 1, Math.floor((z - bounds.minZ) / cellSize))),
  });
  const toWorld = (ix, iz) => ({ x: bounds.minX + (ix + 0.5) * cellSize, z: bounds.minZ + (iz + 0.5) * cellSize });

  const blockedCache = new Map();
  const isBlocked = (ix, iz) => {
    const k = key(ix, iz);
    if (blockedCache.has(k)) return blockedCache.get(k);
    const p = toWorld(ix, iz);
    let b = false;
    for (const o of obstacles) {
      const r = (o.r || 1) + margin;
      const dx = p.x - o.x, dz = p.z - o.z;
      if (dx * dx + dz * dz < r * r) { b = true; break; }
    }
    blockedCache.set(k, b);
    return b;
  };

  const s = toCell(start.x, start.z);
  const g = toCell(goal.x, goal.z);
  if (isBlocked(g.ix, g.iz)) {
    // try to find nearest free cell around goal
    let found = null;
    for (let rad = 1; rad <= 6 && !found; rad++) {
      for (let dx = -rad; dx <= rad && !found; dx++) for (let dz = -rad; dz <= rad && !found; dz++) {
        const nx = g.ix + dx, nz = g.iz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        if (!isBlocked(nx, nz)) { found = { ix: nx, iz: nz }; }
      }
    }
    if (found) { g.ix = found.ix; g.iz = found.iz; } else return null;
  }

  const h = (ix, iz) => Math.hypot(ix - g.ix, iz - g.iz);
  const open = [{ ix: s.ix, iz: s.iz, g: 0, f: h(s.ix, s.iz), parent: null }];
  const gScore = new Map([[key(s.ix, s.iz), 0]]);
  const closed = new Set();
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let expanded = 0;

  while (open.length) {
    // simple extract-min (ok for small grids)
    let bestI = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestI].f) bestI = i;
    const cur = open.splice(bestI, 1)[0];
    const ck = key(cur.ix, cur.iz);
    if (cur.ix === g.ix && cur.iz === g.iz) {
      const path = [];
      let n = cur;
      while (n) { path.push(toWorld(n.ix, n.iz)); n = n.parent; }
      path.reverse();
      path.push({ x: goal.x, z: goal.z });
      // simplify: drop very close consecutive points
      const out = [];
      for (const p of path) {
        if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.z - out[out.length - 1].z) > 0.4) out.push(p);
      }
      return out.length ? out : null;
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (++expanded > maxNodes) return null;
    for (const [dx, dz] of dirs) {
      const nx = cur.ix + dx, nz = cur.iz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const nk = key(nx, nz);
      if (closed.has(nk) || isBlocked(nx, nz)) continue;
      // prevent corner-cutting through blocked diagonals
      if (dx !== 0 && dz !== 0 && (isBlocked(cur.ix + dx, cur.iz) || isBlocked(cur.ix, cur.iz + dz))) continue;
      const step = (dx === 0 || dz === 0) ? 1 : Math.SQRT2;
      const ng = cur.g + step;
      if (ng >= (gScore.get(nk) ?? Infinity)) continue;
      gScore.set(nk, ng);
      open.push({ ix: nx, iz: nz, g: ng, f: ng + h(nx, nz), parent: cur });
    }
  }
  return null;
}
