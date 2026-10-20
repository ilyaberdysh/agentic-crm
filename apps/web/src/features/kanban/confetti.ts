// Confetti "ceiling drop" (C2 kanban.md K3 Confetti preview, K8 drop into a celebration stage; evidence
// kanban-stage-color-confetti.png): small paper pieces fall from above the viewport across its whole width, flutter
// and fade out after ~3 s. A single fixed canvas (pointer-events none) driven by requestAnimationFrame; a second burst
// while one runs adds pieces to it. Nothing runs under `prefers-reduced-motion: reduce` (motion.md §5).

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rotation (rad) and its speed; the flutter scales the piece's width by cos(rotation). */
  rotation: number;
  spin: number;
  width: number;
  height: number;
  color: string;
  shape: 'rect' | 'ellipse';
  /** Seconds since the burst. */
  age: number;
}

/** Muted paper colours close to the evidence (teal, coral, butter, lavender, pink, mint). */
export const CONFETTI_COLORS = ['#4fd1c5', '#f2777a', '#f6d365', '#b9a6e8', '#f49ac1', '#7ed9a6', '#8ec5ff'];

export const BURST_SECONDS = 3.2;
const FADE_SECONDS = 0.7;
const GRAVITY = 260; // px/s²
const DRAG = 0.985;

type Random = () => number;

/** Pieces of one burst over a viewport `width` × `height` (spawned above the top edge). */
export function spawnBurst(width: number, height: number, count = 160, random: Random = Math.random): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const big = random() < 0.35;
    out.push({
      x: random() * width,
      y: -random() * height * 0.45 - 10,
      vx: (random() - 0.5) * 70,
      vy: 60 + random() * 140,
      rotation: random() * Math.PI * 2,
      spin: (random() - 0.5) * 9,
      width: big ? 7 + random() * 3 : 4 + random() * 3,
      height: big ? 3 + random() * 2 : 5 + random() * 3,
      color: CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)] as string,
      shape: random() < 0.4 ? 'ellipse' : 'rect',
      age: 0,
    });
  }
  return out;
}

/** Advances the pieces by `dt` seconds; returns the ones still alive. Pure (mutates nothing it does not return). */
export function stepParticles(particles: readonly Particle[], dt: number, height: number): Particle[] {
  const out: Particle[] = [];
  for (const p of particles) {
    const age = p.age + dt;
    if (age > BURST_SECONDS || p.y > height + 40) continue;
    const vy = Math.min(p.vy + GRAVITY * dt, 420) * DRAG;
    const vx = p.vx * DRAG + Math.sin(age * 3 + p.rotation) * 14 * dt;
    out.push({ ...p, age, vx, vy, x: p.x + vx * dt, y: p.y + vy * dt, rotation: p.rotation + p.spin * dt });
  }
  return out;
}

export function particleAlpha(p: Particle): number {
  const left = BURST_SECONDS - p.age;
  return left >= FADE_SECONDS ? 1 : Math.max(0, left / FADE_SECONDS);
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

// ---- runner ------------------------------------------------------------------------------------------------------------

interface Running {
  canvas: HTMLCanvasElement;
  particles: Particle[];
  frame: number;
  last: number;
}

let running: Running | null = null;
let fired = 0;

/** Number of bursts fired this session (e2e reads it through `window.__kanbanConfetti`). */
export function confettiCount(): number {
  return fired;
}

function draw(ctx: CanvasRenderingContext2D, particles: readonly Particle[], dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = particleAlpha(p) * 0.9;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.scale(Math.max(0.15, Math.abs(Math.cos(p.rotation * 1.3))), 1);
    ctx.fillStyle = p.color;
    if (p.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.width / 2, p.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
    }
    ctx.restore();
  }
}

/** Fires one burst (adds to a running one). No-op without a DOM, without canvas support or with reduced motion. */
export function fireConfetti(): void {
  fired++;
  if (typeof window !== 'undefined') (window as unknown as { __kanbanConfetti?: number }).__kanbanConfetti = fired;
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (running) {
    running.particles.push(...spawnBurst(width, height));
    return;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.testid = 'kanban-confetti';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
    zIndex: '100000',
  });
  document.body.appendChild(canvas);
  const state: Running = { canvas, particles: spawnBurst(width, height), frame: 0, last: performance.now() };
  running = state;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;
    state.particles = stepParticles(state.particles, dt, height);
    draw(ctx, state.particles, dpr);
    if (state.particles.length === 0) {
      canvas.remove();
      running = null;
      return;
    }
    state.frame = requestAnimationFrame(tick);
  };
  state.frame = requestAnimationFrame(tick);
}
