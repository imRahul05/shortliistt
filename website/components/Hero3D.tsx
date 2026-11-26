'use client';
import { useRef } from 'react';

const BASE = { x: 12, y: -22 };

export default function Hero3D() {
  const stage = useRef<HTMLDivElement>(null);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !stage.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    stage.current.style.transform = `rotateX(${BASE.x - py * 14}deg) rotateY(${BASE.y + px * 18}deg)`;
  };
  const reset = () => {
    if (stage.current) stage.current.style.transform = `rotateX(${BASE.x}deg) rotateY(${BASE.y}deg)`;
  };

  return (
    <div className="scene relative mx-auto h-[440px] w-full max-w-[560px] sm:h-[500px]" onPointerMove={onMove} onPointerLeave={reset} aria-hidden>
      {/* glow */}
      <div className="absolute inset-16 rounded-full bg-white/[.06] blur-[90px]" />
      <div className="absolute right-6 bottom-10 h-40 w-40 rounded-full bg-mint/20 blur-[70px]" />

      <div ref={stage} className="stage relative h-full w-full" style={{ transform: `rotateX(${BASE.x}deg) rotateY(${BASE.y}deg)` }}>
        {/* Browser window with job posting */}
        <div className="absolute top-8 left-0 w-[86%] overflow-hidden rounded-2xl border border-white/10 bg-[#0f1422] shadow-[0_40px_80px_-20px_rgba(0,0,0,.8)]" style={{ transform: 'translateZ(0px)' }}>
          <div className="flex items-center gap-1.5 border-b border-white/5 bg-white/[.03] px-3 py-2.5">
            <span className="size-2.5 rounded-full bg-coral/80" /><span className="size-2.5 rounded-full bg-amber/80" /><span className="size-2.5 rounded-full bg-mint/80" />
            <div className="ml-3 h-5 flex-1 rounded-md bg-white/5 px-2 font-mono text-[10px] leading-5 text-dim">careers.acme.com/jobs/senior-backend</div>
            <div className="ml-2 grid size-5 place-items-center rounded-md bg-mint text-[9px] font-bold text-ink">82</div>
          </div>
          <div className="space-y-3 p-5">
            <div className="h-4 w-2/3 rounded bg-white/80" />
            <div className="h-2.5 w-1/3 rounded bg-white/20" />
            <div className="pt-2 text-[10px] font-semibold tracking-widest text-dim uppercase">Requirements</div>
            {[92, 78, 85, 64, 72].map((w, i) => (
              <div key={i} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-white/30" /><div className="h-2 rounded bg-white/10" style={{ width: `${w}%` }} /></div>
            ))}
            <div className="pt-2 text-[10px] font-semibold tracking-widest text-dim uppercase">Nice to have</div>
            {[58, 70].map((w, i) => (
              <div key={i} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-white/30" /><div className="h-2 rounded bg-white/10" style={{ width: `${w}%` }} /></div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <div className="absolute top-0 right-0 w-[58%] rounded-2xl border border-white/10 bg-[#121829]/95 p-4 shadow-[0_50px_90px_-20px_rgba(0,0,0,.9)] backdrop-blur" style={{ transform: 'translateZ(90px)' }}>
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 110 110" className="size-24 -rotate-90">
              <circle cx="55" cy="55" r="46" fill="none" stroke="rgb(255 255 255 / .08)" strokeWidth="10" />
              <circle className="ring" cx="55" cy="55" r="46" fill="none" stroke="#3ee6a8" strokeWidth="10" strokeLinecap="round" strokeDasharray="289" strokeDashoffset="52" />
                          </svg>
            <div>
              <div className="text-3xl font-semibold tracking-tight">82<span className="text-base text-dim">%</span></div>
              <div className="text-sm font-medium text-mint">Strong match</div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {[['Skills', 86], ['Experience', 100], ['Keywords', 71]].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[70px_1fr] items-center gap-2 text-[11px] text-dim">
                {k}<div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-mint" style={{ width: `${v}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[10px] font-semibold tracking-widest text-dim uppercase">Must-have</div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
            {['Java', 'Spring Boot', 'AWS', 'Docker'].map(s => <span key={s} className="rounded-full bg-mint/10 px-2 py-0.5 text-mint">✓ {s}</span>)}
            <span className="rounded-full bg-amber/10 px-2 py-0.5 text-amber">~ PostgreSQL</span>
            <span className="rounded-full bg-coral/10 px-2 py-0.5 text-coral">✗ Kafka</span>
          </div>
        </div>

        {/* Floating chips */}
        <div className="absolute bottom-16 left-[14%] sm:left-[8%]" style={{ transform: 'translateZ(160px)' }}>
          <div className="float rounded-xl border border-white/10 bg-ink-2/90 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur">
            <span className="text-mint">+ Kafka</span> <span className="text-dim">added to Skills</span>
          </div>
        </div>
        <div className="absolute right-[6%] bottom-6" style={{ transform: 'translateZ(130px)' }}>
          <div className="float-slow rounded-xl border border-white/10 bg-ink-2/90 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur">
            <span className="text-dim">resume_acme.pdf</span> <span className="text-blue">↓</span>
          </div>
        </div>
      </div>
    </div>
  );
}
