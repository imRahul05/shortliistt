'use client';
import { useRef } from 'react';

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

export default function IsoHero() {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !ref.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    ref.current.style.setProperty('--tz', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
    ref.current.style.setProperty('--tx', `${((e.clientY - r.top) / r.height - 0.5) * -6}deg`);
  };
  const reset = () => { ref.current?.style.setProperty('--tz', '0deg'); ref.current?.style.setProperty('--tx', '0deg'); };

  return (
    <div className="iso-scene relative mx-auto aspect-[1/1] w-full max-w-[560px]" onPointerMove={onMove} onPointerLeave={reset} aria-hidden>
      <div className="iso-glow" />
      <div ref={ref} className="iso-world">
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
    </div>
  );
}
