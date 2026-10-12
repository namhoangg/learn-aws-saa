import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SearchPalette } from './SearchPalette';
import { useProgress } from '../state/store';
import { useDialogFocus } from '../lib/useDialogFocus';

export function Layout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();
  const progress = useProgress();
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  // A running exam hides the sidebar and search, like the real test.
  const focusMode = pathname === '/exam' && !!progress.exam;
  const shortcuts = progress.settings.shortcuts !== false;

  // Close the drawer after navigating.
  useEffect(() => setDrawerOpen(false), [pathname]);
  // While open, the drawer keeps focus; every way of closing it returns focus to the menu button.
  useDialogFocus(drawerRef, drawerOpen, menuRef);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  useEffect(() => {
    if (focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (shortcuts && e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode, shortcuts]);

  return (
    <div className={`app${drawerOpen ? ' app--drawer-open' : ''}${focusMode ? ' app--focus' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar menuRef={menuRef} onMenu={() => setDrawerOpen((o) => !o)} onSearch={() => setSearchOpen(true)} menuOpen={drawerOpen} focusMode={focusMode} />
      <div className="app__body">
        {!focusMode && <Sidebar navRef={drawerRef} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />}
        {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-hidden />}
        <main id="main" className="app__content" tabIndex={-1}>
          {children}
        </main>
      </div>
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

/** True when keys go into a text field; quiz radios and lab checkboxes do not count. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
}
