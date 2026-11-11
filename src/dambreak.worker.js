/* Studena dam-break: local-inertial 2D shallow-water solver (Bates et al. 2010,
 * de Almeida et al. 2012) on the 28 m SRTM grid. Runs in a Web Worker.
 *
 * State: bed z, depth h, unit discharges qx (x-faces) and qy (y-faces).
 * The breach is lowered from crest to the downstream toe over the breach
 * formation time (Froehlich 2008), or almost instantly for a total collapse.
 */
const g = 9.81;
let R, C, N, dx, A, z, h, qx, qy, n2, hmaxCell, masks, built, breachIdx;
let crest, zFinal, tf, t = 0, running = false, speed = 300, duration = 3 * 3600;
let r0, r1, c0, c1, hmax = 1, V0 = 0, lastPost = 0, lastStat = -1e9;
let prevRes = 0, prevT = 0, peakQ = 0, pernikAt = null, pernikBox, peakArea = 0, peakBuilt = 0;

function init(m) {
  R = m.rows; C = m.cols; N = R * C; dx = m.dx; A = dx * dx;
  z = new Float32Array(m.z); masks = m.masks; built = m.built;
  h = new Float32Array(N); hmaxCell = new Float32Array(N);
  qx = new Float32Array(R * (C + 1)); qy = new Float32Array((R + 1) * C);
  n2 = new Float32Array(N);
  for (let i = 0; i < N; i++) { const n = 0.035 + 0.06 * (built[i] / 255); n2[i] = n * n; }
  crest = m.crest; zFinal = m.toe; pernikBox = m.pernikBox;
  const collapse = m.mode === 'collapse';
  tf = collapse ? 60 : m.tf;
  const b = [];
  for (let i = 0; i < N; i++) {
    const isDam = masks[i] & 2, isBreach = masks[i] & 4;
    if (collapse ? isDam : isBreach) b.push(i);
    if (masks[i] & 1) h[i] = Math.max(0, m.level - z[i]);
  }
  breachIdx = Int32Array.from(b);
  V0 = 0; for (let i = 0; i < N; i++) if (masks[i] & 1) V0 += h[i] * A;
  prevRes = V0; prevT = 0; peakQ = 0; pernikAt = null; peakArea = 0; peakBuilt = 0;
  t = 0; hmax = 1; for (let i = 0; i < N; i++) if (h[i] > hmax) hmax = h[i];
  bbox();
}

function bbox() {
  r0 = R; r1 = -1; c0 = C; c1 = -1;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) if (h[i * C + j] > 1e-3) {
    if (i < r0) r0 = i; if (i > r1) r1 = i; if (j < c0) c0 = j; if (j > c1) c1 = j;
  }
  for (const k of breachIdx) { const i = (k / C) | 0, j = k % C; r0 = Math.min(r0, i); r1 = Math.max(r1, i); c0 = Math.min(c0, j); c1 = Math.max(c1, j); }
}

function step(dt) {
  // lower the breach
  const zb = crest - (crest - zFinal) * Math.min(1, t / tf);
  for (const k of breachIdx) if (z[k] > zb) z[k] = zb;

  const ra = Math.max(1, r0 - 2), rb = Math.min(R - 2, r1 + 2);
  const ca = Math.max(1, c0 - 2), cb = Math.min(C - 2, c1 + 2);
  const vcap = 25;
  // x-faces
  for (let i = ra; i <= rb; i++) {
    const row = i * C, frow = i * (C + 1);
    for (let j = ca; j <= cb + 1; j++) {
      const il = row + j - 1, ir = row + j;
      const zl = z[il], zr = z[ir], el = zl + h[il], er = zr + h[ir];
      const hf = Math.max(el, er) - Math.max(zl, zr);
      const k = frow + j;
      if (hf <= 1e-3) { qx[k] = 0; continue; }
      const q0 = qx[k];
      let q = (q0 - g * hf * dt * (er - el) / dx) / (1 + g * dt * 0.5 * (n2[il] + n2[ir]) * Math.abs(q0) / (hf * hf * Math.cbrt(hf)));
      const qm = hf * vcap; if (q > qm) q = qm; else if (q < -qm) q = -qm;
      qx[k] = q;
    }
  }
  // y-faces
  for (let i = ra; i <= rb + 1; i++) {
    const fr = i * C;
    for (let j = ca; j <= cb; j++) {
      const iu = (i - 1) * C + j, id = i * C + j;
      const zu = z[iu], zd = z[id], eu = zu + h[iu], ed = zd + h[id];
      const hf = Math.max(eu, ed) - Math.max(zu, zd);
      const k = fr + j;
      if (hf <= 1e-3) { qy[k] = 0; continue; }
      const q0 = qy[k];
      let q = (q0 - g * hf * dt * (ed - eu) / dx) / (1 + g * dt * 0.5 * (n2[iu] + n2[id]) * Math.abs(q0) / (hf * hf * Math.cbrt(hf)));
      const qm = hf * vcap; if (q > qm) q = qm; else if (q < -qm) q = -qm;
      qy[k] = q;
    }
  }
  // continuity
  let nr0 = R, nr1 = -1, nc0 = C, nc1 = -1, hm = 0.5;
  const f = dt / dx;
  for (let i = ra; i <= rb; i++) {
    for (let j = ca; j <= cb; j++) {
      const k = i * C + j;
      let v = h[k] + f * (qx[i * (C + 1) + j] - qx[i * (C + 1) + j + 1] + qy[i * C + j] - qy[(i + 1) * C + j]);
      if (v < 0) v = 0;
      if (i <= 1 || j <= 1 || i >= R - 2 || j >= C - 2) v = 0;     // water leaving the domain
      h[k] = v;
      if (v > 1e-3) {
        if (i < nr0) nr0 = i; if (i > nr1) nr1 = i; if (j < nc0) nc0 = j; if (j > nc1) nc1 = j;
        if (v > hm) hm = v;
        if (v > hmaxCell[k]) hmaxCell[k] = v;
      }
    }
  }
  if (nr1 >= 0) { r0 = nr0; r1 = nr1; c0 = nc0; c1 = nc1; }   // wet area; the loops add a 2-cell margin
  for (const k of breachIdx) { const i = (k / C) | 0, j = k % C; r0 = Math.min(r0, i); r1 = Math.max(r1, i); c0 = Math.min(c0, j); c1 = Math.max(c1, j); }
  hmax = hm;
  t += dt;
}

function stats() {
  let res = 0, area = 0, bh = 0, pernik = false;
  const [pr0, pc0, pr1, pc1] = pernikBox;
  for (let i = 0; i < N; i++) {
    const v = h[i];
    if (masks[i] & 1) { res += v * A; continue; }
    if (v > 0.1) { area += A; if (v > 0.3) bh += A * built[i] / 255; }
  }
  for (let i = pr0; i <= pr1 && !pernik; i++) for (let j = pc0; j <= pc1; j++) {
    const k = i * C + j; if (built[k] > 128 && h[k] > 0.3) { pernik = true; break; }
  }
  if (pernik && pernikAt === null) pernikAt = t;
  const q = t > prevT ? (prevRes - res) / (t - prevT) : 0;
  if (q > peakQ) peakQ = q;
  prevRes = res; prevT = t;
  peakArea = Math.max(peakArea, area); peakBuilt = Math.max(peakBuilt, bh);
  postMessage({ type: 'stats', t, released: (V0 - res) / 1e6, reservoir: res / 1e6, V0: V0 / 1e6, outflow: Math.max(0, q), peakQ,
    area: area / 1e6, built: bh / 1e4, peakArea: peakArea / 1e6, peakBuilt: peakBuilt / 1e4, pernikAt, breachPct: Math.min(1, t / tf), done: t >= duration });
}

function frame() {
  const d = new Uint8Array(N), s = new Uint8Array(N);
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const k = i * C + j, v = h[k];
    if (v < 0.02) continue;
    d[k] = Math.min(255, Math.round(v * 20));
    if (v > 0.05) {
      const u = 0.5 * (qx[i * (C + 1) + j] + qx[i * (C + 1) + j + 1]) / v;
      const w = 0.5 * (qy[i * C + j] + qy[(i + 1) * C + j]) / v;
      s[k] = Math.min(255, Math.round(Math.hypot(u, w) * 10));
    }
  }
  postMessage({ type: 'frame', t, depth: d, speed: s }, [d.buffer, s.buffer]);
}

let target = 0, lastWall = 0;
function loop() {
  if (!running) return;
  const now = performance.now();
  target = Math.min(target + ((now - lastWall) / 1000) * speed, t + speed * 0.3, duration);
  lastWall = now;
  const until = now + 30;
  while (t < target && performance.now() < until) {
    // always a full CFL step: truncating steps to hit the wall-clock target makes the
    // local-inertial scheme oscillate, so the clock may run a fraction of a step ahead
    const dt = Math.min(5, 0.7 * dx / Math.sqrt(g * Math.max(hmax, 0.5)));
    step(dt);
  }
  if (now - lastPost > 60) { frame(); lastPost = now; }
  if (t - lastStat > 20 || t >= duration) { stats(); lastStat = t; }
  if (t >= duration) { running = false; frame(); postMessage({ type: 'done', t }); return; }
  setTimeout(loop, 0);
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { init(m); frame(); stats(); postMessage({ type: 'ready' }); }
  else if (m.type === 'play') { if (!running) { running = true; lastWall = performance.now(); target = t; loop(); } }
  else if (m.type === 'pause') { running = false; }
  else if (m.type === 'speed') { speed = m.speed; }
  else if (m.type === 'maxextent') {
    const d = new Uint8Array(N), s = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (hmaxCell[i] >= 0.02 && !(masks[i] & 1)) d[i] = Math.min(255, Math.round(hmaxCell[i] * 20));
    postMessage({ type: 'frame', t, depth: d, speed: s, max: true }, [d.buffer, s.buffer]);
  }
};
