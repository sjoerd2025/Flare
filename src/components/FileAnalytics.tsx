import { useEffect, useRef, type ReactNode } from 'react';

/** A non-modal companion to the editor: the file remains usable alongside it. */
export function FileAnalytics({ children, onClose, embedded = false }: { children: ReactNode; onClose?(): void; embedded?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (embedded) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [embedded]);

  return (
    <aside ref={panel} className="file-analytics" role={embedded ? 'complementary' : 'dialog'} aria-modal={embedded ? undefined : false}
      aria-label="File analytics" tabIndex={embedded ? undefined : -1} data-testid="file-analytics"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose?.(); }
      }}>
      <header className="file-analytics-head">
        <div><span className="file-analytics-eyebrow">FILE INSIGHTS</span><h2>Analytics &amp; history</h2></div>
        {onClose && <button className="ehbtn" onClick={onClose} aria-label="Close file analytics" title="Close (Esc)" data-testid="details-close">×</button>}
      </header>
      <div className="details-panel file-analytics-body">{children}</div>
    </aside>
  );
}
