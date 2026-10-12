import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Moon, Search, SlidersHorizontal, Sun, X } from 'lucide-react';
import { setTheme } from '../state/store';
import { useResolvedTheme } from '../lib/theme';
import { Logo } from './Logo';

interface Props {
  onMenu: () => void;
  onSearch: () => void;
  menuOpen: boolean;
  focusMode: boolean;
  menuRef: RefObject<HTMLButtonElement | null>;
}

export function TopBar({ onMenu, onSearch, menuOpen, focusMode, menuRef }: Props) {
  const theme = useResolvedTheme();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="topbar">
      {!focusMode && (
        <button
          ref={menuRef}
          type="button"
          className="icon-btn topbar__menu"
          aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      )}
      <Link to="/" className="brand" aria-label="SAA-C03 Study, home">
        <Logo />
        <span className="brand__name">SAA-C03 Study</span>
      </Link>
      {!focusMode ? (
        <button type="button" className="topbar__search" onClick={onSearch} aria-label="Search lessons, cards, questions and labs">
          <Search size={18} aria-hidden />
          <span className="topbar__search-text">Search lessons, cards, questions, labs</span>
          <span className="topbar__kbd" aria-hidden>
            <kbd className="kbd">{isMac ? '⌘' : 'Ctrl'}</kbd>
            <kbd className="kbd">K</kbd>
          </span>
        </button>
      ) : (
        <span className="topbar__mode">Exam simulation · 65 questions · 130 minutes</span>
      )}
      <div className="topbar__actions">
        <button
          type="button"
          className="icon-btn"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun size={20} strokeWidth={1.75} aria-hidden /> : <Moon size={20} strokeWidth={1.75} aria-hidden />}
        </button>
        {!focusMode && (
          <Link to="/settings" className="icon-btn topbar__settings" aria-label="Progress and settings">
            <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden />
          </Link>
        )}
      </div>
    </header>
  );
}
