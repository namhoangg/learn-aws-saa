import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus handling (DESIGN_SPEC §11): while `open`, Tab and Shift+Tab cycle inside the
 * container, focus starts inside it, and on close it returns to what had focus before
 * (or to `returnTo` when given).
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean, returnTo?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const items = () => (box ? [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement) : []);
    if (box && !box.contains(document.activeElement)) {
      const auto = box.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      (auto ?? items()[0] ?? box).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !box) return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const target = returnTo?.current ?? previous;
      // Restore after React has removed the dialog.
      requestAnimationFrame(() => target?.focus?.());
    };
  }, [open, ref, returnTo]);
}
