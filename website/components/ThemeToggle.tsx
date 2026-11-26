'use client';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => { setTheme((document.documentElement.dataset.theme as Theme) || 'dark'); }, []);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    const root = document.documentElement;
    root.classList.add('theme-anim');
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    setTheme(next);
    window.setTimeout(() => root.classList.remove('theme-anim'), 400);
  };

  const dark = theme !== 'light';
  return (
    <button type="button" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}
      className="grid size-8 place-items-center rounded-full border border-line text-fg/70 transition hover:border-fg/30 hover:text-fg">
      {/* render both icons, show one via CSS so the server render never mismatches */}
      <svg viewBox="0 0 24 24" className="size-4 theme-icon-sun" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg viewBox="0 0 24 24" className="size-4 theme-icon-moon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
