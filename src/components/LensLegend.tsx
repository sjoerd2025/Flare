import { LENSES, lensHue, ramp, type Lens } from '../graph/lenses';
import { IconFoldAll, IconUnfoldAll } from './icons';

interface Props {
  lens: Lens;
  /** set when the active lens has nothing to colour — shown instead of the scale */
  emptyNote?: string | null;
  /** directory chips — always available, they double as fold/unfold controls */
  clusters: { name: string; color: string; count: number; collapsed: boolean }[];
  onToggleDir(dir: string): void;
  onFoldAll(): void;
  onUnfoldAll(): void;
  /** the folder chips are put away — the summary and the toggle stay */
  collapsed: boolean;
  onToggleCollapsed(): void;
  /** which half renders: the lens scale, the folders bar, or (default) both.
      The scale lives in the graph toolbar; the folders live in the sidebar. */
  show?: 'reading' | 'folders' | 'both';
}

const RAMP_STOPS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Tells the user what the current colours mean, and gives every folder a chip
 * that folds it into a single card or opens it again. Without the first, the
 * lens buttons are just eight ways to make the graph a different colour;
 * without the second there is no way back from a folder you unfolded, since
 * its card is gone by then.
 */
export function LensLegend({
  lens,
  emptyNote,
  clusters,
  onToggleDir,
  onFoldAll,
  onUnfoldAll,
  collapsed,
  onToggleCollapsed,
  show = 'both',
}: Props) {
  const def = LENSES.find((l) => l.id === lens) ?? LENSES[0];
  const foldable = clusters.filter((c) => c.name !== '(root)' && c.count >= 2);
  const folded = foldable.filter((c) => c.collapsed).length;

  return (
    <>
      {show !== 'folders' && (
      <div className={`lens-reading${emptyNote ? ' quiet' : ''}`} data-testid="lens-reading">
        <span className="lens-reading-name">{def.label}</span>
        {/*
          The explanation is behind the ⓘ, not printed here.

          Reading what a lens means is a once-per-lens act; reading the colours
          is continuous. Spending three lines of the strip on the first pushed
          the second — the thing you actually consult — around and made the bar
          above the graph tall enough to be chrome. `emptyNote` stays inline
          because it is not an explanation: it says this lens has nothing to
          colour, which is about the repo in front of you rather than about the
          lens, and hiding it would leave a legend with no scale and no reason.
        */}
        {emptyNote && <span className="lens-reading-text">{emptyNote}</span>}
        <button
          className="lens-info"
          aria-label={`What ${def.label} colours mean`}
          data-testid="lens-info"
        >
          ⓘ
          <span className="lens-info-pop" role="tooltip">
            <b>{def.hint}</b>
            {def.reading}
          </span>
        </button>
        {!emptyNote && def.scale.kind === 'ramp' && (
          <span className="lens-scale" data-testid="lens-scale">
            <span className="lens-scale-end">{def.scale.low}</span>
            <span className="lens-ramp">
              {RAMP_STOPS.map((stop) => (
                <span key={stop} style={{ background: ramp(lensHue(def.id), stop) }} />
              ))}
            </span>
            <span className="lens-scale-end">{def.scale.high}</span>
          </span>
        )}
        {!emptyNote && def.scale.kind === 'swatches' && (
          <span className="lens-scale" data-testid="lens-scale">
            {def.scale.items.map((item) => (
              <span key={item.label} className="lens-swatch">
                <span className="swatch" style={{ background: item.color() }} />
                {item.label}
              </span>
            ))}
          </span>
        )}
      </div>
      )}

      {show !== 'reading' && clusters.length > 0 && (
        <section className={`graph-folders${collapsed ? ' folded-away' : ''}`} data-testid="legend">
          <button className="graph-folders-heading" aria-expanded={!collapsed}
            onClick={onToggleCollapsed} data-testid="legend-collapse"
            title={collapsed ? 'Show graph folder controls' : 'Hide graph folder controls'}>
            <span aria-hidden="true">{collapsed ? '\u25b8' : '\u25be'}</span>
            <span>Graph folders</span>
            <span className="graph-folders-count">{folded} grouped</span>
          </button>
          {!collapsed && <>
            <p className="graph-folders-help">Group a folder into one graph card, or show its files.</p>
            {foldable.length > 0 && <div className="graph-folders-actions">
              <button onClick={onFoldAll} disabled={folded === foldable.length} data-testid="legend-fold-all">
                <IconFoldAll size={12} /> Group all
              </button>
              <button onClick={onUnfoldAll} disabled={folded === 0} data-testid="legend-unfold-all">
                <IconUnfoldAll size={12} /> Show all files
              </button>
            </div>}
            <div className="graph-folders-list">
              {clusters.map((c) => {
                const canFold = c.name !== '(root)' && c.count >= 2;
                return <button key={c.name} className="graph-folder-row" disabled={!canFold}
                  onClick={() => onToggleDir(c.name)} data-testid={`legend-${c.name}`}
                  aria-label={`${c.name}: ${c.count} files${canFold ? c.collapsed ? ', show files' : ', group into one card' : ''}`}
                  title={canFold ? c.collapsed ? 'Show the files in this folder on the graph' : 'Group this folder into one graph card' : 'No folder group available'}>
                  <span className="graph-folder-swatch" style={{ background: c.color }} />
                  <span className="graph-folder-name">{c.name === '(root)' ? 'Root files' : c.name}</span>
                  <span className="graph-folder-count">{c.count}</span>
                  <span className="graph-folder-action">{canFold ? c.collapsed ? 'Show files' : 'Group' : ''}</span>
                </button>;
              })}
            </div>
          </>}
        </section>
      )}
    </>
  );
}
