import IsoHero from '@/components/IsoHero';
import ThemeToggle from '@/components/ThemeToggle';
import { ChromeLogo, SITES, SiteLogo } from '@/components/Brand';

const REPO = 'https://github.com/imRahul05/shortliistt';
const ZIP = `${REPO}/releases/latest/download/shortlist-extension.zip`;

/** Latest release from GitHub, refreshed at most hourly (ISR) — no redeploy needed after a release. */
async function latestVersion(): Promise<string | null> {
  try {
    const r = await fetch('https://api.github.com/repos/imRahul05/shortliistt/releases/latest', { next: { revalidate: 3600 }, headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    return ((await r.json()) as { tag_name?: string }).tag_name ?? null;
  } catch { return null; }
}

function DownloadButton({ size = 'lg', label = 'Add to Chrome — free' }: { size?: 'sm' | 'lg'; label?: string }) {
  const cls = size === 'lg' ? 'gap-2.5 px-5 py-3 text-[15px]' : 'gap-2 px-3.5 py-1.5 text-sm';
  return (
    <a href={ZIP} className={`group inline-flex items-center rounded-full bg-fg font-medium text-ink shadow-[0_1px_0_rgba(255,255,255,.4)_inset,0_8px_24px_-8px_rgba(255,255,255,.25)] transition hover:opacity-90 ${cls}`}>
      <ChromeLogo className={size === 'lg' ? 'size-5' : 'size-4'} />{label}
    </a>
  );
}

const features = [
  { tag: 'Match', title: 'A score you can trust', body: 'Reads the job straight from the page’s DOM, splits must-haves from nice-to-haves, and checks skills, years, degree and keywords. Deterministic — same input, same score.', accent: 'text-blue' },
  { tag: 'Tailor', title: 'Resume Studio', body: 'Live editor with the score updating as you type. Add missing skills, surface relevant bullets, export PDF or DOCX.', accent: 'text-mint' },
  { tag: 'Apply', title: 'Autofill in one click', body: 'Name, email, links, experience — and your resume file attached. Works on Greenhouse, Lever and most forms.', accent: 'text-amber' },
  { tag: 'AI', title: 'Built-in AI', body: 'Insights, rewrites and cover letters with Chrome’s built-in Gemini Nano. No key, no subscription. Off? Everything still works.', accent: 'text-coral' },
];

const steps = [
  ['Upload your resume', 'PDF, DOCX or TXT. Parsed in the browser.'],
  ['Open any job posting', 'A score card appears on the page.'],
  ['Tailor and apply', 'Fix the gaps, export, autofill. Done.'],
];


function GitHubIcon() {
  return <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>;
}

export default async function Home() {
  const version = await latestVersion();
  return (
    <main className="relative overflow-x-clip">
      <div className="hero-bg" aria-hidden><div className="aurora a1" /><div className="aurora a2" /><div className="aurora a3" /><div className="dots" /><div className="horizon" /><div className="grain" /><div className="fade" /></div>

      {/* Nav (sticky) */}
      <header className="sticky top-0 z-50 border-b border-line/70 bg-ink/70 backdrop-blur-xl supports-[backdrop-filter]:bg-ink/55">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <img src="/icon.png" alt="" className="size-7" />Shortlist
          </a>
          <div className="flex items-center gap-5 text-sm text-dim">
            <a href="#features" className="hidden hover:text-fg md:block">Features</a>
            <a href="#install" className="hidden hover:text-fg md:block">Install</a>
            <a href={REPO} aria-label="GitHub" className="hidden text-fg/70 hover:text-fg sm:block"><GitHubIcon /></a>
            <ThemeToggle />
            <DownloadButton size="sm" label="Add to Chrome" />
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pt-10 pb-24 lg:grid-cols-[1fr_1.05fr] lg:pt-16">
        <div className="rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-ink-2 px-3 py-1 font-mono text-xs text-dim">
            <span className="size-1.5 rounded-full bg-mint" />Free · No API keys
          </span>
          <h1 className="mt-6 text-5xl font-semibold tracking-[-0.04em] text-balance sm:text-6xl lg:text-7xl">
            Know your <span className="hl-mark">fit</span><br />
            <span className="text-dim">before you </span>
            <span className="hl-under">apply.<svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden><path d="M1 7 C 22 2.5, 45 2, 62 4.5 S 88 8.5, 99 3.5" fill="none" stroke="#3ee6a8" strokeWidth="3" strokeLinecap="round" pathLength={1} vectorEffect="non-scaling-stroke" /></svg></span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-dim">
            Shortlist reads the job page, scores your resume against it and tailors it in one click — entirely inside Chrome.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <DownloadButton />
            <a href={REPO} className="flex items-center gap-2 rounded-full border border-line px-5 py-3 font-medium transition hover:border-fg/30"><GitHubIcon />View source</a>
          </div>
          <p className="mt-4 font-mono text-xs text-dim">{version ? `${version} · ` : ''}Free · Works in Chrome, Edge &amp; Brave</p>
        </div>
        <IsoHero />
      </section>

      {/* Sites */}
      <section className="relative z-10 border-y border-line bg-ink-2">
        <div className="mx-auto max-w-6xl px-6 py-7">
          <p className="text-center font-mono text-xs tracking-widest text-dim uppercase">Works on every job site</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-9 gap-y-5">
            {SITES.map(s => <SiteLogo key={s.name} site={s} />)}
            <span className="font-mono text-xs text-dim">+ any careers page</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">Everything between “found a job” and “applied”.</h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
          {features.map(f => (
            <div key={f.title} className="group bg-ink p-8 transition hover:bg-ink-2">
              <span className={`font-mono text-xs tracking-widest uppercase ${f.accent}`}>{f.tag}</span>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 leading-relaxed text-dim">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How + privacy */}
      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-24 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-line p-8">
          <h2 className="text-2xl font-semibold tracking-tight">Three steps.</h2>
          <ol className="mt-8 space-y-6">
            {steps.map(([t, d], i) => (
              <li key={t} className="flex gap-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line font-mono text-sm text-blue">{i + 1}</span>
                <div><div className="font-medium">{t}</div><div className="text-dim">{d}</div></div>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-2 p-8">
          <h2 className="text-2xl font-semibold tracking-tight">Your resume never leaves your browser.</h2>
          <dl className="mt-8 grid grid-cols-2 gap-6">
            {[['0', 'servers'], ['0', 'API keys'], ['0', 'accounts'], ['100%', 'local']].map(([n, l]) => (
              <div key={l}><dt className="text-4xl font-semibold tracking-tight">{n}</dt><dd className="text-sm text-dim">{l}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      {/* Install */}
      <section id="install" className="mx-auto max-w-6xl px-6 pb-28">
        <div className="rounded-2xl border border-line bg-ink-2 p-8 sm:p-12">
          <h2 className="text-3xl font-semibold tracking-tight">Install in a minute.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-4">
            {[
              ['Download', <a key="a" href={ZIP} className="text-blue hover:underline">the latest release</a>, ' and unzip it'],
              ['Open', <code key="c" className="font-mono text-fg">chrome://extensions</code>],
              ['Enable', 'Developer mode (top right)'],
              ['Click', 'Load unpacked → pick the folder'],
            ].map(([h, ...rest], i) => (
              <div key={i} className="rounded-xl border border-line bg-ink p-5">
                <div className="font-mono text-xs text-dim">0{i + 1}</div>
                <div className="mt-2 font-medium">{h}</div>
                <div className="mt-1 text-sm text-dim">{rest}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <DownloadButton label="Download Shortlist" />
            {version && <span className="font-mono text-xs text-dim">Latest: {version}</span>}
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-dim">
          <span className="flex items-center gap-2"><img src="/icon.png" alt="" className="size-5" />© 2026 Rahul Kumar · Shortlist is free to use</span>
          <div className="flex items-center gap-6">
            <a href="/privacy" className="hover:text-fg">Privacy</a>
            <a href={`${REPO}/blob/main/LICENSE.md`} className="hover:text-fg">License</a>
            <a href={REPO} className="hover:text-fg">github.com/imRahul05/shortliistt</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
