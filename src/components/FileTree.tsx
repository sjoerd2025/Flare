import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FileTreeNode, GitFileState } from '../../shared/types';
import { api } from '../api';
import { UI_STATUS } from '../theme';
import { FileGlyph, IconUpload, IconClose, IconChevron } from './icons';

/**
 * A file-manager glyph per extension family.
 *
 * Everything here is Basic-Multilingual-Plane and predates emoji, so it
 * resolves from an ordinary text face on Windows, macOS and Linux alike. The
 * script and Python marks were U+1D5E7/U+1D5E3 (Mathematical Sans-Serif Bold),
 * which ship in Segoe UI Symbol but are missing from most Linux installs —
 * a whole column of the tree rendered as tofu there. Plain letters now,
 * weighted by CSS.
 *
 * Deliberately monochrome and set in the UI font: the tree's colour budget
 * belongs to git state, not to a rainbow of file types.
 */
const FILE_ICONS: { re: RegExp; icon: string; kind: string }[] = [
  { re: /\.(test|spec)\.[jt]sx?$|_test\.py$|^test_/i, icon: '◉', kind: 'test' },
  { re: /\.(tsx|jsx)$/i, icon: '◇', kind: 'component' },
  { re: /\.(ts|js|mjs|cjs)$/i, icon: 'T', kind: 'script' },
  { re: /\.py$/i, icon: 'P', kind: 'python' },
  { re: /\.(json|ya?ml|toml|ini)$|^\.env(?:\..*)?$/i, icon: '⚙︎', kind: 'config' },
  { re: /\.(md|mdx|txt|rst)$/i, icon: '¶', kind: 'doc' },
  { re: /\.(css|scss|less)$/i, icon: '◧', kind: 'style' },
  { re: /\.(png|jpe?g|gif|svg|ico|webp)$/i, icon: '▨', kind: 'image' },
];

function fileIcon(name: string): { icon: string; kind: string } {
  for (const entry of FILE_ICONS) {
    if (entry.re.test(name)) return { icon: entry.icon, kind: entry.kind };
  }
  return { icon: '▪', kind: 'file' };
}

export const STATE_COLOR: Record<GitFileState, string> = {
  modified: UI_STATUS.warning,
  added: UI_STATUS.good,
  untracked: UI_STATUS.good,
  deleted: UI_STATUS.critical,
  renamed: UI_STATUS.serious,
  conflicted: UI_STATUS.critical,
};

interface Props {
  tree: FileTreeNode;
  gitFiles: Record<string, GitFileState>;
  selected: string | null;
  selectedPaths: ReadonlySet<string>;
  onOpenFile(path: string): void;
  onSelect(path: string): void;
  onToggleSelect(path: string): void;
  onRowContextMenu(payload: { x: number; y: number; path: string; isDir: boolean }): void;
  onSelectPaths(paths: string[]): void;
  onBeforeMove(paths: string[]): boolean;
  onMoved(paths: string[], target: string): void;
  onRename(path: string): void;
  onDelete(entries: { path: string; isDir: boolean }[]): void;
  onNotice(message: string, error?: boolean): void;
  /** cluster -> colour, from the graph, so top-level folders echo the map */
  clusterColors?: Record<string, string>;
}

/** Lets the explorer header drive the tree without owning every folder's state. */
export interface FileTreeHandle {
  copy(paths: string[], cut?: boolean): void;
  paste(target: string): void;
  upload(target: string): void;
  collapseAll(): void;
  expandAll(): void;
  /** open every ancestor of a path so a selection made elsewhere is visible */
  reveal(path: string): void;
}


const DRAG_TYPE = 'application/x-flare-files';

export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree(props, ref) {
  const { tree } = props;
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set((tree.children ?? []).filter((n) => n.type === 'dir').map((n) => n.path)));
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState('');
  const [clipboard, setClipboard] = useState<{ paths: string[]; cut: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef('');
  const dragOwner = useRef(globalThis.crypto?.randomUUID?.() ?? `explorer-${Date.now()}-${Math.random()}`);
  const anchor = useRef('');
  const nodes = useMemo(() => {
    const result = new Map<string, FileTreeNode>();
    const walk = (node: FileTreeNode) => { result.set(node.path, node); node.children?.forEach(walk); };
    walk(tree);
    return result;
  }, [tree]);
  const rows = useMemo(() => {
    const result: { node: FileTreeNode; depth: number }[] = [];
    const needle = query.trim().toLowerCase();
    const matches = new Set<string>();
    if (needle) for (const node of nodes.values()) {
      if (!node.path.toLowerCase().includes(needle)) continue;
      let p = node.path;
      while (p) { matches.add(p); p = p.split('/').slice(0, -1).join('/'); }
    }
    const walk = (node: FileTreeNode, depth: number) => {
      if (needle && !matches.has(node.path)) return;
      result.push({ node, depth });
      if (needle || openDirs.has(node.path)) node.children?.forEach((child) => walk(child, depth + 1));
    };
    tree.children?.forEach((child) => walk(child, 0));
    return result;
  }, [tree, nodes, query, openDirs]);
  const reveal = (path: string) => {
    setQuery('');
    setOpenDirs((prev) => {
      const next = new Set(prev);
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
      return next;
    });
    setFocused(path);
  };
  useEffect(() => {
    if (props.selected) reveal(props.selected.startsWith('@dir:') ? props.selected.slice(5) : props.selected);
  }, [props.selected]);
  const targetDir = (path: string) => nodes.get(path)?.type === 'dir' ? path : path.split('/').slice(0, -1).join('/');
  const chosen = (path: string) => props.selectedPaths.has(path) ? [...props.selectedPaths].filter((p) => nodes.has(p) && p) : path ? [path] : [];
  const copy = (paths: string[], cut = false) => {
    setClipboard({ paths, cut });
    props.onNotice(`${paths.length} item${paths.length === 1 ? '' : 's'} ready to ${cut ? 'move' : 'copy'}`);
  };
  const transfer = async (paths: string[], target: string, move: boolean) => {
    if (busyRef.current || !paths.length) return;
    if (move && !props.onBeforeMove(paths)) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await api.transferFiles(paths, target, move);
      if (!result || result.error) throw new Error(result?.error ?? 'Connection unavailable');
      if (move) { setClipboard(null); props.onMoved(paths, target); }
      setOpenDirs((prev) => new Set([...prev, target]));
      props.onNotice(`${move ? 'Moved' : 'Copied'} ${paths.length} item${paths.length === 1 ? '' : 's'}`);
    } catch (error) { props.onNotice(String(error), true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const paste = (target: string) => {
    if (clipboard) void transfer(clipboard.paths, target, clipboard.cut);
    else props.onNotice('Copy or cut files in the explorer first. Use Upload files for local files.');
  };
  const upload = (target: string) => { uploadTarget.current = target; picker.current?.click(); };
  const importFiles = async (files: { file: File; path: string }[], target: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    let count = 0;
    try {
      for (const { file, path } of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${path}: maximum file size is 20 MB`);
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error(`Could not read ${path}`));
          reader.readAsDataURL(file);
        });
        const result = await api.importFile([target, path].filter(Boolean).join('/'), base64);
        if (!result || result.error) throw new Error(result?.error ?? 'Connection unavailable');
        count++;
      }
      setOpenDirs((prev) => new Set([...prev, target]));
      props.onNotice(`Imported ${count} file${count === 1 ? '' : 's'}`);
    } catch (error) { props.onNotice(`Imported ${count} files. ${String(error)}`, true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useImperativeHandle(ref, () => ({
    collapseAll: () => setOpenDirs(new Set()),
    expandAll: () => setOpenDirs(new Set([...nodes.values()].filter((n) => n.type === 'dir').map((n) => n.path))),
    reveal, copy, paste, upload,
  }));
  const toggle = (path: string, open?: boolean) => setOpenDirs((prev) => {
    const next = new Set(prev);
    if (open ?? !next.has(path)) next.add(path); else next.delete(path);
    return next;
  });
  const focusRow = (path: string) => {
    setFocused(path);
    requestAnimationFrame(() => {
      const row = Array.from(container.current?.querySelectorAll<HTMLElement>('[data-path]') ?? []).find((el) => el.dataset.path === path);
      row?.focus(); row?.scrollIntoView({ block: 'nearest' });
    });
  };
  const drop = async (event: React.DragEvent, target: string) => {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const internal = event.dataTransfer.getData(DRAG_TYPE);
    if (internal) {
      try {
        const payload = JSON.parse(internal);
        if (payload.root !== dragOwner.current || !Array.isArray(payload.paths)) return;
        await transfer(payload.paths, target, !(event.ctrlKey || event.metaKey || event.altKey));
      } catch (error) { props.onNotice(String(error), true); }
      return;
    }
    // Capture entries before the drag event's data store is released.
    const entries = Array.from(event.dataTransfer.items).map((item) => item.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    const fallback = Array.from(event.dataTransfer.files);
    const files: { file: File; path: string }[] = [];
    const walk = async (entry: FileSystemEntry, parent: string) => {
      const path = parent + entry.name;
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
        files.push({ file, path });
      } else {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        while (true) {
          const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
          if (!children.length) break;
          for (const child of children) await walk(child, path + '/');
        }
      }
    };
    try {
      if (entries.length) for (const entry of entries) await walk(entry, '');
      else files.push(...fallback.map((file) => ({ file, path: file.name })));
      await importFiles(files, target);
    } catch (error) { props.onNotice(String(error), true); }
  };
  return <div className="explorer-files" aria-busy={busy}>
    <div className="explorer-filter">
      <input aria-label="Filter files" placeholder="Filter files…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {query && <button aria-label="Clear file filter" onClick={() => setQuery('')}><IconClose size={14} /></button>}
      <button className="explorer-upload" title="Upload local files into the selected project folder" aria-label="Upload files" disabled={busy} onClick={() => upload(targetDir(focused))}><IconUpload size={16} /><span>Upload</span></button>
    </div>
    <input ref={picker} type="file" multiple hidden onChange={(e) => {
      void importFiles(Array.from(e.target.files ?? []).map((file) => ({ file, path: file.name })), uploadTarget.current);
      e.target.value = '';
    }} />
    <div ref={container} className={`filetree${dropTarget === '' ? ' drop-target' : ''}`} role="tree" aria-label="Project files" aria-multiselectable="true" tabIndex={0} data-testid="filetree"
      onDragOver={(e) => { e.preventDefault(); if (e.target === e.currentTarget) setDropTarget(''); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); }}
      onDrop={(e) => void drop(e, '')}
      onPaste={(e) => {
        if (e.clipboardData.files.length) {
          e.preventDefault(); e.stopPropagation();
          void importFiles(Array.from(e.clipboardData.files).map((file) => ({ file, path: file.name })), targetDir(focused));
        } else if (clipboard) { e.preventDefault(); e.stopPropagation(); paste(targetDir(focused)); }
      }}
      onKeyDown={(e) => {
        const index = rows.findIndex(({ node }) => node.path === focused);
        const node = nodes.get(focused);
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); props.onSelectPaths(rows.map((r) => r.node.path)); }
        else if ((e.ctrlKey || e.metaKey) && ['c', 'x'].includes(e.key.toLowerCase())) { e.preventDefault(); copy(chosen(focused), e.key.toLowerCase() === 'x'); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
          if (rows[next]) focusRow(rows[next].node.path);
        } else if (e.key === 'ArrowRight' && node?.type === 'dir') { e.preventDefault(); if (!openDirs.has(focused)) toggle(focused, true); else if (rows[index + 1]) focusRow(rows[index + 1].node.path); }
        else if (e.key === 'ArrowLeft' && node) { e.preventDefault(); if (openDirs.has(focused)) toggle(focused, false); else focusRow(focused.split('/').slice(0, -1).join('/')); }
        else if (e.key === 'Enter' && node) { e.preventDefault(); if (node.type === 'dir') toggle(focused); else props.onOpenFile(focused); }
        else if (e.key === ' ' && node) { e.preventDefault(); props.onToggleSelect(focused); }
        else if (e.key === 'F2' && node) { e.preventDefault(); props.onRename(focused); }
        else if (e.key === 'Delete' && node) { e.preventDefault(); props.onDelete(chosen(focused).map((path) => ({ path, isDir: nodes.get(path)?.type === 'dir' }))); }
        else if (e.key === 'Escape') { e.preventDefault(); setClipboard(null); setQuery(''); }
        if (e.defaultPrevented) e.stopPropagation();
      }}
      onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); props.onRowContextMenu({ x: e.clientX, y: e.clientY, path: '', isDir: true }); } }}>
      {rows.map(({ node, depth }) => {
        const dir = node.type === 'dir';
        const open = !!query || openDirs.has(node.path);
        const state = props.gitFiles[node.path];
        const target = targetDir(node.path);
        return <div key={node.path} role="treeitem" aria-level={depth + 1} aria-expanded={dir ? open : undefined} aria-selected={props.selected === node.path || props.selectedPaths.has(node.path)}
          tabIndex={focused === node.path ? 0 : -1} data-path={node.path} draggable={!busy}
          className={`row${dir ? ' dir-row' : ''}${props.selected === node.path ? ' selected' : ''}${props.selectedPaths.has(node.path) ? ' multi-selected' : ''}${clipboard?.cut && clipboard.paths.includes(node.path) ? ' cut' : ''}${dropTarget === node.path ? ' drop-target' : ''}`}
          data-testid={`tree-${dir ? 'dir' : 'file'}-${node.path}`} title={`${node.path}${state ? ` • ${state}` : ''}`}
          onFocus={() => setFocused(node.path)}
          onClick={(e) => {
            focusRow(node.path);
            if (e.shiftKey && anchor.current) {
              const start = rows.findIndex((r) => r.node.path === anchor.current);
              const end = rows.findIndex((r) => r.node.path === node.path);
              props.onSelectPaths(rows.slice(Math.max(0, Math.min(start, end)), Math.max(start, end) + 1).map((r) => r.node.path));
            } else if (e.ctrlKey || e.metaKey) props.onToggleSelect(node.path);
            else if (dir) { toggle(node.path); props.onSelect(node.path); }
            else props.onSelect(node.path);
            if (!e.shiftKey) anchor.current = node.path;
          }}
          onDoubleClick={() => { if (!dir) props.onOpenFile(node.path); }}
          onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ root: dragOwner.current, paths: chosen(node.path) })); e.dataTransfer.effectAllowed = 'copyMove'; }}
          onDragEnd={() => setDropTarget(null)}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(node.path); e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey || e.altKey || !e.dataTransfer.types.includes(DRAG_TYPE) ? 'copy' : 'move'; }}
          onDrop={(e) => void drop(e, target)}
          onContextMenu={(e) => { e.preventDefault(); focusRow(node.path); props.onRowContextMenu({ x: e.clientX, y: e.clientY, path: node.path, isDir: dir }); }}>
          {Array.from({ length: depth }, (_, i) => <span className="indent" key={i} />)}
          <span className={`chev${dir && open ? ' expanded' : ''}`}>{dir && <IconChevron size={12} />}</span>
          {dir ? <span className={`folder${open ? ' open' : ''}`} aria-hidden="true" style={depth === 0 && props.clusterColors?.[node.name] ? { '--folder-c': props.clusterColors[node.name] } as React.CSSProperties : undefined} /> : <span className={`ficon ${fileIcon(node.name).kind}`}><FileGlyph kind={fileIcon(node.name).kind} /></span>}
          <span className="fname">{node.name}</span>
          {state && <span className="file-state" style={{ color: STATE_COLOR[state] }} aria-label={state}>{state[0].toUpperCase()}</span>}
        </div>;
      })}
      {!rows.length && <div className="explorer-empty">{query ? 'No matching files' : 'Drop files here to add them'}</div>}
    </div>
    <div className="explorer-foot">{busy ? 'Transferring files…' : clipboard ? `${clipboard.paths.length} ready to ${clipboard.cut ? 'move' : 'copy'} · Paste into a folder` : `${[...nodes.values()].filter((n) => n.type === 'file').length} files · Drop to import`}</div>
  </div>;
});
