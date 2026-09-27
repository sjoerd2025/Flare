# Sidebar and file-management review

The explorer now keeps file navigation primary. The duplicate Changed section is removed; review remains in the Review view. File analytics no longer occupies the sidebar or opens on selection. Double-clicking a graph file shows analytics beside its preview; double-clicking an explorer file opens analytics beside the editor. Graph folders is a collapsible list with file counts, an explanation, and explicit Group / Show files actions. These actions switch to the graph so their effect is visible.

## IDE comparison

The baseline is [VS Code's Explorer](https://code.visualstudio.com/docs/editing/getting-started/userinterface): file/folder operations, multiple selection, external drops, and clipboard workflows.

| Workflow | Flare desktop and web |
| --- | --- |
| New file/folder, rename, delete | Existing actions retained; F2 and Delete available when the tree has focus |
| Find a file | Path filter preserves ancestors; opening a file elsewhere reveals its ancestors |
| Select multiple items | Ctrl/Cmd click, Shift click range, Space to toggle |
| Navigate | Arrow keys, Home/End, Enter to open, visible keyboard focus |
| Copy/cut/paste inside the project | Ctrl/Cmd+C/X/V and context menus; folders included |
| Move/copy by dragging | Drop on a folder; Ctrl/Cmd/Alt copies; blank tree area targets project root |
| Import local files | Upload button, external drop, or paste when the host exposes clipboard files |
| Import folder contents | External directory drops preserve relative paths (empty directories are not imported) |
| Prevent accidental overwrites | Existing destinations rejected; batch copy/move preflight; imports report partial progress |
| Unsaved editors | Save or close unsaved edits before a move; saved source tabs close after moving |
| Track repository files | All readable, non-ignored files appear on the graph; configuration, SQL, text, extensionless files and assets included |

## Boundaries and remaining gaps

- Ignore rules still apply, including `.gitignore`; a gitignored `.env` stays excluded. Graph inclusion does not stage files in Git.
- JS/TS, Python and Markdown retain their existing dependency parsing. Other formats receive graph records without invented dependencies or code-quality warnings. Binary and oversized files use metadata-only records.
- Uploads are limited to 20 MB per file. Import batches stop on the first error and report how many files succeeded; existing files are never overwritten.
- Internal clipboard state belongs to the current explorer. OS file clipboard exposure varies by browser/platform; the upload button and drag/drop are available alternatives. Cross-project clipboard transfer and native drag-out/export are not implemented.
- Inline rename, operation undo, conflict-resolution prompts, and automatic import-path rewrites remain gaps compared with mature IDEs. Rename/delete retain the existing dialogs; deletes retain local-history snapshots.
