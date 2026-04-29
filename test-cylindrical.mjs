// Standalone Node harness for the cylindrical-projection changes:
//   1. Seamless-wrap snap math: aspectU / scaleU must land on a positive integer.
//   2. Offset-center cylindrical UV: atan2 is computed relative to cylinderCenter,
//      not bounds.center, so a pie slice projects identically to a centered cylinder
//      rotated by the same theta.
//   3. Auto-fit: Kasa least-squares circle fit recovers center+radius from
//      noisy points sampled on a known partial cylinder.
//
// Run: node test-cylindrical.mjs

import { computeUV, MODE_CYLINDRICAL } from './js/mapping.js';

let _failed = 0;
function expect(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
    _failed++;
  }
}
function approxEq(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ── Mirror of _snapScaleUForSeamlessWrap from js/main.js ─────────────────────
function snapScaleUForSeamlessWrap(scaleU, aspectU = 1, MAX_TILES = 20) {
  let n = Math.round(aspectU / Math.max(scaleU, 1e-6));
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > MAX_TILES) n = MAX_TILES;
  return parseFloat((aspectU / n).toFixed(4));
}

// ── Test 1: snap math ────────────────────────────────────────────────────────
console.log('Test 1: snap math');
{
  const aU = 1;
  // Snapping to nearest integer wrap count
  expect('aspectU/scaleU=1.0 → snap to 1.0',  approxEq(snapScaleUForSeamlessWrap(0.95, aU), 1.0));
  expect('aspectU/scaleU=2.0 → snap to 0.5',  approxEq(snapScaleUForSeamlessWrap(0.55, aU), 0.5));
  expect('aspectU/scaleU=3.0 → snap to 0.3333',approxEq(snapScaleUForSeamlessWrap(0.30, aU), 0.3333, 1e-3));
  expect('aspectU/scaleU=5.0 → snap to 0.2',  approxEq(snapScaleUForSeamlessWrap(0.21, aU), 0.2, 1e-3));
  expect('aspectU/scaleU=20.0 → cap at MAX', approxEq(snapScaleUForSeamlessWrap(0.04, aU), 0.05, 1e-3));
  expect('aspectU/scaleU=0.5 → snap to 1.0 (min N=1)', approxEq(snapScaleUForSeamlessWrap(2.5, aU), 1.0));

  // Non-square texture aspect
  const aW = 1.5;  // wide texture, aspectU = max/w
  // For wide texture, height is wider — aU = tmax/tw = 1/1 = 1 if tw is the max,
  // but the field is named differently. Let's just sanity-check the formula:
  expect('aspectU=1.5 → scaleU=0.75 → wraps 2× (snap unchanged)',
    approxEq(snapScaleUForSeamlessWrap(0.75, aW), 0.75, 1e-3));
}

// ── Test 2: cylindrical UV with offset center ────────────────────────────────
console.log('\nTest 2: offset-center cylindrical UV');
{
  // Build an artificial bounds that shifts AABB center far away from the
  // physical cylinder center — like a quarter pie slice whose AABB centroid is
  // inside the missing wedge.
  const bounds = {
    min:    { x: 0,  y: 0,  z: 0 },
    max:    { x: 10, y: 10, z: 5 },
    size:   { x: 10, y: 10, z: 5 },
    center: { x: 5,  y: 5,  z: 2.5 },
  };
  // The actual cylinder is centered at (0,0) with radius 10 — only the +X+Y
  // quadrant exists (the pie slice).
  const settings = {
    scaleU: 1, scaleV: 1, offsetU: 0, offsetV: 0, rotation: 0,
    textureAspectU: 1, textureAspectV: 1,
    mappingBlend: 0,           // pure side projection, no cap blend
    seamBandWidth: 0,          // disable seam crossfade for cleaner math
    cylinderCenterX: 0,
    cylinderCenterY: 0,
    cylinderRadius:  10,
  };

  // A point at (10, 0, 2.5) in world space — on the +X arc → theta=0 → uRaw=0.5
  const sample1 = computeUV({ x: 10, y: 0, z: 2.5 }, { x: 1, y: 0, z: 0 },
                            MODE_CYLINDRICAL, settings, bounds);
  // After uu = uRaw/scaleU + offsetU = 0.5, fract → 0.5
  expect('point at theta=0 → u≈0.5',
         sample1.triplanar ? sample1.samples[0].u !== undefined : approxEq(sample1.u, 0.5, 1e-4),
         JSON.stringify(sample1));

  // A point at (0, 10, 2.5) — on the +Y arc → theta=π/2 → uRaw = 0.25 + 0.5 = 0.75
  const sample2 = computeUV({ x: 0, y: 10, z: 2.5 }, { x: 0, y: 1, z: 0 },
                            MODE_CYLINDRICAL, settings, bounds);
  expect('point at theta=π/2 → u≈0.75',
         approxEq(sample2.u ?? sample2.samples[0].u, 0.75, 1e-4),
         JSON.stringify(sample2));

  // Same point but if we'd used bounds.center (5,5) instead, the relative vec
  // would be (-5, 5) → atan2=3π/4 → uRaw = 0.875. Confirm the offset-aware path
  // does NOT yield 0.875.
  expect('offset center ≠ AABB center result (0.75 ≠ 0.875)',
         !approxEq(sample2.u ?? sample2.samples[0].u, 0.875, 1e-3));

  // Now flip to AABB-default behavior: leave cylinderCenter* unset.
  const settingsDefault = { ...settings };
  delete settingsDefault.cylinderCenterX;
  delete settingsDefault.cylinderCenterY;
  delete settingsDefault.cylinderRadius;
  const sample3 = computeUV({ x: 0, y: 10, z: 2.5 }, { x: 0, y: 1, z: 0 },
                            MODE_CYLINDRICAL, settingsDefault, bounds);
  // With AABB center=(5,5), point (0,10) → (-5, 5) → atan2 = 3π/4 → uRaw = 0.875
  expect('default (AABB) center → u≈0.875 (the legacy behavior)',
         approxEq(sample3.u ?? sample3.samples[0].u, 0.875, 1e-4),
         JSON.stringify(sample3));
}

// ── Test 3: V-axis circumference scaling honors cylinderRadius ───────────────
console.log('\nTest 3: V uses cylinderRadius for circumference');
{
  const bounds = {
    min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 6 },
    size: { x: 4, y: 4, z: 6 }, center: { x: 2, y: 2, z: 3 },
  };
  // With AABB radius (max(4,4)/2 = 2), C = 2π·2 ≈ 12.566 → vSide for z=6 ≈ 6/12.566 ≈ 0.477
  // With cylinderRadius=4, C = 2π·4 ≈ 25.13  → vSide for z=6 ≈ 6/25.13 ≈ 0.2387
  const baseSettings = {
    scaleU: 1, scaleV: 1, offsetU: 0, offsetV: 0, rotation: 0,
    textureAspectU: 1, textureAspectV: 1,
    mappingBlend: 0, seamBandWidth: 0,
  };
  const aDefault = computeUV({ x: 4, y: 2, z: 6 }, { x: 1, y: 0, z: 0 },
                             MODE_CYLINDRICAL, baseSettings, bounds);
  const aOverride = computeUV({ x: 4, y: 2, z: 6 }, { x: 1, y: 0, z: 0 },
                              MODE_CYLINDRICAL,
                              { ...baseSettings, cylinderCenterX: 2, cylinderCenterY: 2, cylinderRadius: 4 },
                              bounds);
  const vDefault = aDefault.v ?? aDefault.samples[0].v;
  const vOverride = aOverride.v ?? aOverride.samples[0].v;
  expect('default V at z=6 with r=2 → ≈0.477',  approxEq(vDefault, 6 / (2 * Math.PI * 2), 1e-3));
  expect('override V at z=6 with r=4 → ≈0.239', approxEq(vOverride, 6 / (2 * Math.PI * 4), 1e-3));
  expect('changing cylinderRadius changes V', !approxEq(vDefault, vOverride, 1e-3));
}

// ── Test 4: Kasa least-squares circle fit ────────────────────────────────────
console.log('\nTest 4: Kasa least-squares circle fit');
{
  // Mirror of autoFitCylinderAxis() math — synthetic points on a known circle.
  function fitCircle(points) {
    let n = 0, Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
    for (const [x, y] of points) {
      const z = x * x + y * y;
      Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
      Sxz += x * z; Syz += y * z; Sz += z;
      n++;
    }
    const M = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
    const b = [Sxz, Syz, Sz];
    const det = (m) =>
        m[0][0]*(m[1][1]*m[2][2] - m[1][2]*m[2][1])
      - m[0][1]*(m[1][0]*m[2][2] - m[1][2]*m[2][0])
      + m[0][2]*(m[1][0]*m[2][1] - m[1][1]*m[2][0]);
    const D = det(M);
    if (Math.abs(D) < 1e-12) return null;
    const colReplace = (col) => M.map((row, i) => row.map((v, j) => j === col ? b[i] : v));
    const A = det(colReplace(0)) / D;
    const B = det(colReplace(1)) / D;
    const C = det(colReplace(2)) / D;
    const cx = A / 2, cy = B / 2;
    const r2 = C + cx * cx + cy * cy;
    if (r2 <= 0) return null;
    return { cx, cy, r: Math.sqrt(r2) };
  }

  // Quarter-pie sample: 50 points on the arc of a circle centered at (3, 7), radius 5
  const truth = { cx: 3, cy: 7, r: 5 };
  const points = [];
  for (let i = 0; i <= 50; i++) {
    const t = i / 50 * (Math.PI / 2);          // 0 .. π/2 → quarter arc
    const noise = (Math.random() - 0.5) * 0.02; // ±0.01 mm wiggle
    points.push([
      truth.cx + (truth.r + noise) * Math.cos(t),
      truth.cy + (truth.r + noise) * Math.sin(t),
    ]);
  }
  const fit = fitCircle(points);
  expect('quarter-arc fit recovers center.x ±0.05', fit && approxEq(fit.cx, truth.cx, 0.05),
         fit ? `cx=${fit.cx.toFixed(4)}` : 'no fit');
  expect('quarter-arc fit recovers center.y ±0.05', fit && approxEq(fit.cy, truth.cy, 0.05),
         fit ? `cy=${fit.cy.toFixed(4)}` : 'no fit');
  expect('quarter-arc fit recovers radius ±0.05',  fit && approxEq(fit.r,  truth.r,  0.05),
         fit ? `r=${fit.r.toFixed(4)}` : 'no fit');

  // Half-arc → tighter fit, even with noise
  const half = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100 * Math.PI;
    const noise = (Math.random() - 0.5) * 0.02;
    half.push([truth.cx + (truth.r + noise) * Math.cos(t),
               truth.cy + (truth.r + noise) * Math.sin(t)]);
  }
  const fitHalf = fitCircle(half);
  expect('half-arc fit recovers center.x ±0.01', fitHalf && approxEq(fitHalf.cx, truth.cx, 0.01),
         fitHalf ? `cx=${fitHalf.cx.toFixed(4)}` : 'no fit');
  expect('half-arc fit recovers radius ±0.01',  fitHalf && approxEq(fitHalf.r,  truth.r,  0.01),
         fitHalf ? `r=${fitHalf.r.toFixed(4)}` : 'no fit');
}

// ── Test 5: Snap-then-project produces identical samples on both sides of the seam
console.log('\nTest 5: snap eliminates the seam (left-side ≈ right-side after snap)');
{
  const bounds = {
    min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 5 },
    size: { x: 10, y: 10, z: 5 }, center: { x: 5, y: 5, z: 2.5 },
  };
  // Two points across the atan2 seam — just inside theta=π and just inside theta=-π.
  const tNear = Math.PI - 1e-4;
  const p1 = { x: 5 + 5 * Math.cos(tNear),  y: 5 + 5 * Math.sin(tNear),  z: 2.5 };
  const p2 = { x: 5 + 5 * Math.cos(-tNear), y: 5 + 5 * Math.sin(-tNear), z: 2.5 };
  const baseSettings = {
    scaleV: 1, offsetU: 0, offsetV: 0, rotation: 0,
    textureAspectU: 1, textureAspectV: 1,
    mappingBlend: 0,
    seamBandWidth: 0, // disable crossfade so we observe the raw seam
  };

  // With a non-snapped scaleU the two samples land on different texels.
  const nonSnapped = { ...baseSettings, scaleU: 0.345 };
  const a1 = computeUV(p1, { x: 1, y: 0, z: 0 }, MODE_CYLINDRICAL, nonSnapped, bounds);
  const a2 = computeUV(p2, { x: 1, y: 0, z: 0 }, MODE_CYLINDRICAL, nonSnapped, bounds);
  const u1 = a1.u ?? a1.samples[0].u;
  const u2 = a2.u ?? a2.samples[0].u;
  // After fract these differ by approx fract(2/scaleU) - which is generally non-zero
  expect('non-snapped scale → seam samples differ (visible seam)',
         Math.abs(u1 - u2) > 1e-3,
         `u1=${u1.toFixed(4)} u2=${u2.toFixed(4)}`);

  // Now snap to seamless.
  const snapped = snapScaleUForSeamlessWrap(0.345, 1);
  const snappedSettings = { ...baseSettings, scaleU: snapped };
  const b1 = computeUV(p1, { x: 1, y: 0, z: 0 }, MODE_CYLINDRICAL, snappedSettings, bounds);
  const b2 = computeUV(p2, { x: 1, y: 0, z: 0 }, MODE_CYLINDRICAL, snappedSettings, bounds);
  const su1 = b1.u ?? b1.samples[0].u;
  const su2 = b2.u ?? b2.samples[0].u;
  // After snap, fract(uu) on either side of the seam should converge to the
  // same fractional value (within numerical noise from theta=π±tiny offset).
  const seamGap = Math.min(Math.abs(su1 - su2), 1 - Math.abs(su1 - su2));
  expect(`snapped scale=${snapped} → seam samples match (seamless)`,
         seamGap < 5e-3,
         `su1=${su1.toFixed(4)} su2=${su2.toFixed(4)} gap=${seamGap.toFixed(4)}`);
}

console.log(`\n${_failed === 0 ? 'All tests passed' : `FAILED: ${_failed} test(s)`}`);
process.exit(_failed === 0 ? 0 : 1);
