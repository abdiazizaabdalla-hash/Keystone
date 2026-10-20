'use client';

import { useEffect, useRef, useState } from 'react';

// Lets a person drop files from their computer (or an email app) onto any
// upload area in the app, not only onto the exact button. It works by finding
// the file picker the drop was aimed at and handing it the files exactly as if
// they had been chosen in the picker, so each page's own validation, size
// limits and security checks run unchanged.
//
// Which picker? Starting from whatever is under the pointer, walk outwards to
// the smallest surrounding area that contains exactly one enabled file
// picker. If an area holds several pickers it is ambiguous, so nothing
// happens there (the cursor shows "not allowed") rather than guessing.
//
// Areas that handle their own drops (document category boxes, the listing
// document areas, the CSV drop box) call preventDefault first, and this
// handler stays out of their way.

const ACTIVE_CLASS = 'file-drop-active';

function carriesFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
}

function enabledPickers(root: Element): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter(
    (i) => !i.disabled && !i.closest('[data-no-file-drop]')
  );
}

function findTarget(start: EventTarget | null): { input: HTMLInputElement; zone: Element } | null {
  let el: Element | null = start instanceof Element ? start : start instanceof Node ? start.parentElement : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const pickers = enabledPickers(el);
    if (pickers.length === 1) return { input: pickers[0], zone: el };
    if (pickers.length > 1) return null;
    el = el.parentElement;
  }
  return null;
}

// Same matching rules the browser applies to an <input accept="...">.
function accepted(file: File, accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return tokens.some((t) => (t.startsWith('.') ? name.endsWith(t) : t.endsWith('/*') ? type.startsWith(t.slice(0, -1)) : type === t));
}

export default function GlobalFileDrop() {
  const [hint, setHint] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const activeZone = useRef<Element | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearZone = () => {
      activeZone.current?.classList.remove(ACTIVE_CLASS);
      activeZone.current = null;
      setHint(false);
    };
    const setZone = (zone: Element | null) => {
      if (activeZone.current === zone) return;
      activeZone.current?.classList.remove(ACTIVE_CLASS);
      activeZone.current = zone;
      zone?.classList.add(ACTIVE_CLASS);
      setHint(!!zone);
    };
    const tell = (message: string) => {
      setNotice(message);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 4000);
    };

    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e) || e.defaultPrevented) return;
      const target = findTarget(e.target);
      // Always take the event: otherwise the browser would open a stray file
      // in this tab and the person would lose what they were doing.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = target ? 'copy' : 'none';
      setZone(target ? target.zone : null);
    };

    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      const handledElsewhere = e.defaultPrevented;
      clearZone();
      if (handledElsewhere) return;
      e.preventDefault();
      const target = findTarget(e.target);
      if (!target) return;
      const { input } = target;
      const dropped = Array.from(e.dataTransfer?.files || []);
      const usable = dropped.filter((f) => accepted(f, input.accept));
      if (usable.length === 0) {
        tell("That kind of file can't be uploaded here.");
        return;
      }
      const chosen = input.multiple ? usable : usable.slice(0, 1);
      if (!input.multiple && usable.length > 1) tell('This upload takes one file at a time, so only the first was used.');
      else if (usable.length < dropped.length) tell("Some files were skipped because that kind of file can't be uploaded here.");
      try {
        const transfer = new DataTransfer();
        chosen.forEach((f) => transfer.items.add(f));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch {
        tell("Your browser couldn't take that drop. Please use the upload button instead.");
      }
    };

    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) clearZone();
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragend', clearZone);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragend', clearZone);
      clearZone();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  if (!hint && !notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4" role="status" aria-live="polite">
      <div className="rounded-full border border-blue-400/60 bg-slate-900/95 px-4 py-2 text-sm text-slate-100 shadow-lg">
        {notice || 'Drop to upload'}
      </div>
    </div>
  );
}
