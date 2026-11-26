'use client';
import { useEffect, useRef, useState } from 'react';

/*
  Isometric "exploded view" of how Shortlist works, in pure CSS 3D (no WebGL, no libraries):
    1. Job posting slab — a scan beam reads it, skill chips light up.
    2. Data particles rise through light beams into the resume slab — matches turn green.
    3. Match slab — ring fills and the score counts up.
  One 7s loop, driven entirely by CSS keyframes (see .iso-* in globals.css).
*/

const JOB_CHIPS = ['React', 'TypeScript', 'AWS', 'Kafka'];
const RES_CHIPS: [string, boolean][] = [['React', true], ['TypeScript', true], ['AWS', true], ['Kafka', false]];

function Slab({ className, z, children }: { className: string; z: number; children: React.ReactNode }) {
  return (
    <div className={`iso-slab ${className}`} style={{ ['--z' as string]: `${z}px` }}>
      <div className="iso-face">{children}</div>
      <div className="iso-side iso-side-b" />
      <div className="iso-side iso-side-r" />
    </div>
  );
}

const BASE = { rx: 58, rz: -45 };
const clampX = (v: number) => Math.max(0, Math.min(72, v)); // 0° = straight top-down, 72° = low side view

export default function IsoHero() {
  const scene = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const st = useRef({ rx: BASE.rx, rz: BASE.rz, vx: 0, vz: 0, drag: false, lx: 0, ly: 0, lt: 0, raf: 0, id: -1 });
  const [hint, setHint] = useState(true);

  const apply = () => {
    const s = st.current;
    world.current?.style.setProperty('--rx', `${s.rx}deg`);
    world.current?.style.setProperty('--rz', `${s.rz}deg`);
  };
  // Momentum after release, decaying smoothly.
  const glide = () => {
    const s = st.current;
    s.vx *= 0.93; s.vz *= 0.93;
    s.rz += s.vz; s.rx = clampX(s.rx + s.vx);
    apply();
    if (Math.abs(s.vx) + Math.abs(s.vz) > 0.02) s.raf = requestAnimationFrame(glide);
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const s = st.current;
    cancelAnimationFrame(s.raf);
    Object.assign(s, { drag: true, lx: e.clientX, ly: e.clientY, lt: performance.now(), vx: 0, vz: 0, id: e.pointerId });
    e.currentTarget.setPointerCapture(e.pointerId);
    scene.current?.classList.add('is-dragging');
    setHint(false);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.drag || e.pointerId !== s.id) return;
    const dx = e.clientX - s.lx, dy = e.clientY - s.ly, now = performance.now(), dt = Math.max(1, now - s.lt);
    const dz = dx * 0.45, dxr = -dy * 0.3;
    s.rz += dz; s.rx = clampX(s.rx + dxr);
    s.vz = (dz / dt) * 16; s.vx = (dxr / dt) * 16; // degrees per frame
    Object.assign(s, { lx: e.clientX, ly: e.clientY, lt: now });
    apply();
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.drag || e.pointerId !== s.id) return;
    s.drag = false;
    scene.current?.classList.remove('is-dragging');
    if (performance.now() - s.lt > 80) { s.vx = 0; s.vz = 0; } // released without a flick
    s.raf = requestAnimationFrame(glide);
  };
  const resetView = () => {
    const s = st.current;
    cancelAnimationFrame(s.raf);
    // Take the short way back around.
    s.rz = BASE.rz + ((((s.rz - BASE.rz) % 360) + 540) % 360) - 180;
    apply();
    requestAnimationFrame(() => { s.rx = BASE.rx; s.rz = BASE.rz; s.vx = s.vz = 0; scene.current?.classList.add('is-resetting'); apply(); setTimeout(() => scene.current?.classList.remove('is-resetting'), 700); });
  };
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);

  return (
    <div ref={scene} className="iso-scene relative mx-auto aspect-[1/1] w-full max-w-[560px]"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={resetView}
      role="img" aria-label="Shortlist reads a job posting, matches it against your resume and shows a match score. Drag to rotate.">
      <div className="iso-glow" />
      <div ref={world} className="iso-world">
        <div className="iso-bob">
          <div className="iso-floor" />
          <div className="iso-shadow" />

          {/* 1 — Job posting */}
          <Slab className="iso-job" z={0}>
            <div className="iso-label"><span className="iso-dot bg-blue" />Job posting</div>
            <div className="iso-line w-[72%]" /><div className="iso-line w-[54%]" /><div className="iso-line w-[63%]" />
            <div className="iso-chips">{JOB_CHIPS.map((c, i) => <span key={c} className="iso-chip iso-chip-job" style={{ animationDelay: `${0.55 + i * 0.28}s` }}>{c}</span>)}</div>
            <div className="iso-scan" />
          </Slab>

          {/* light beams + particles between job and resume */}
          {[[-95, 70], [-20, 92], [70, 70]].map(([x, y], i) => (
            <div key={i} className="iso-beam" style={{ ['--x' as string]: `${x}px`, ['--y' as string]: `${y}px`, animationDelay: `${i * 0.12}s` }}>
              <i style={{ animationDelay: `${i * 0.12}s` }} /><i style={{ animationDelay: `${i * 0.12 + 0.18}s` }} />
            </div>
          ))}

          {/* 2 — Resume */}
          <Slab className="iso-res" z={124}>
            <div className="iso-label"><span className="iso-dot bg-mint" />Your resume</div>
            <div className="iso-line w-[48%]" /><div className="iso-line w-[66%]" />
            <div className="iso-chips">{RES_CHIPS.map(([c, ok], i) => <span key={c} className={`iso-chip ${ok ? 'iso-chip-ok' : 'iso-chip-miss'}`} style={{ animationDelay: `${2.75 + i * 0.22}s` }}>{ok ? '✓' : '✕'} {c}</span>)}</div>
          </Slab>

          {/* 3 — Match */}
          <Slab className="iso-match" z={240}>
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 64 64" className="size-[72px] -rotate-90">
                <circle cx="32" cy="32" r="26" fill="none" stroke="rgb(255 255 255 / .08)" strokeWidth="7" />
                <circle className="iso-ring" cx="32" cy="32" r="26" fill="none" stroke="#3ee6a8" strokeWidth="7" strokeLinecap="round" pathLength={100} strokeDasharray="100" />
              </svg>
              <div>
                <div className="iso-num text-[34px] leading-none font-semibold tracking-tight text-fg"><span className="text-base text-dim">%</span></div>
                <div className="iso-verdict mt-1.5 text-[13px] font-medium text-mint">Strong match</div>
              </div>
            </div>
          </Slab>
        </div>
      </div>
      <div className={`iso-hint ${hint ? '' : 'is-hidden'}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>
        Drag to rotate · double-click to reset
      </div>
    </div>
  );
}
