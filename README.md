# CanvasLide

An infinite canvas for thinking — FigJam's spatial freedom, Notion's blocks,
Obsidian's linked local-file vault. macOS app, Electron shell, no build step.

## Run it

```bash
npm start                                          # dev
npm run dev                                        # dev + devtools protocol on :9222
open dist/CanvasLide-darwin-arm64/CanvasLide.app   # the packaged app
npm run package                                    # rebuild the .app after changes
```

Your data lives in **~/Documents/CanvasLide** — one `.canvaslide.json` file per
page, plus `assets/` for images. Plain files you own.

*File → Change Vault Folder* points it somewhere else, and the choice is
remembered. Point it at an iCloud Drive, Dropbox or Syncthing folder and every
Mac signed into that account shares one vault — sync with no server and no
account of ours. (On this Mac `~/Documents` is already iCloud-synced, so the
default vault is already syncing.)

## Why each piece is here

The feature set is built from what people actually say they love about the three
apps, not from a guess at what they do.

| From | The thing people praise | Here |
|---|---|---|
| Obsidian | typing `[[` and having it autocomplete | `[[` opens a fuzzy page picker; Enter completes it, or creates the page |
| Obsidian | backlinks, and **unlinked mentions** | both in the sidebar's Links tab |
| Obsidian | the graph view | `⌘G` — force-directed, drag nodes, click to open, local-vs-vault toggle |
| Obsidian | plain local files, no lock-in | a folder of JSON, plus **JSON Canvas** import/export |
| Obsidian | quick switcher, daily notes | `⌘K` / `⌘⇧D` |
| Notion | **slash commands** | `/` on the canvas inserts a block; `/` inside a note inserts markdown |
| Notion | blocks, checklists, databases | notes, checklists, and a real table block |
| FigJam | paste a list → one sticky per line | paste multi-line text, or TSV from a spreadsheet for a grid |
| FigJam | frames that move their contents | sections (`F`, or `⇧⌘G` to wrap a selection) |
| FigJam | select-similar, align, distribute | `⌘⇧A`, and the inspector when 2+ things are selected |
| Complaint | *"navigation is the weakest point"* | minimap, outline panel, zoom-to-selection, command palette |
| Complaint | *"I hate fiddling with layout"* | blocks auto-place clear of each other; snap guides; **Tidy into grid** |

## Folders

The sidebar is a folder tree, and it's the same tree that's on disk — a folder
in the app is a real directory in your vault. Make one with the 🗀 button, drag
pages between folders, or use *Move this page to a folder…* from the palette.
Rename or remove a folder from its row (removing one moves its pages back to the
root rather than deleting them). Folders collapse, and new pages are created
wherever you currently are.

## Arrows

Press `A`, then either:

- **drag from one block to another** — the arrow pins to both and re-routes
  itself whenever you move either one
- **drag on empty canvas** — a loose arrow that isn't attached to anything
- **click one block, then click the next** — same as dragging, if that suits you
  better (`Esc` cancels a half-drawn one)

Each end is independent: pin one to a block and leave the other loose for a
callout leader. Select an arrow and drag either grip to re-route it — onto a
block to pin it, onto empty canvas to set it free. The inspector sets the shape
(curve / straight / elbow), which ends get heads, colour, and a label.

**Mounting to a corner.** Drop an end near a corner or the middle of an edge and
it *mounts* there — welded to that exact point, so moving or resizing the block
drags that side of the arrow with it. Drop it anywhere else on the block and the
end stays floating: it slides around the border to face the other end, which is
what you want for loose diagrams. Each block shows its nine mounting points while
the arrow tool is active, and the one you're about to hit lights up. The
inspector has a 3×3 pad per end that maps onto the block's own corners — the
centre cell means "float".

## Blocks

| Block | Key | What it does |
|---|---|---|
| Dimension | `M` | CAD-style measurement between two points, snaps to corners |
| Note | `T` | Markdown card — `[[links]]`, `#tags`, callouts, inline `- [ ]` tasks |
| Sticky | `S` | FigJam sticky, 8 colours |
| Checklist | `K` | Real checkboxes, `Enter` adds a row, progress bar |
| Table | `B` | Editable grid, `Tab` between cells, exports as a markdown table |
| Section | `F` | A frame that drags whatever sits inside it |
| Shape | `R` | Rect / ellipse / diamond / triangle / line, with stroke width |
| Draw | `D` | Freehand ink, colour + width. `E` erases strokes |
| Connector | `A` | Arrow between blocks — or drag a block's side dot |
| Comment | `C` | Pin + threaded replies, sticks to the block it's on |
| Page embed | `/` | A live card mirroring another page's contents |
| Image | — | Paste or drop; copied into the vault |

## Getting around

- **Pan** trackpad scroll · `Space`+drag · `H` — **Zoom** pinch / `⌘`scroll
- `⇧1` fit · `⇧2` zoom to selection · `⌘0` 100%
- **Select** click · `⇧`click · marquee-drag · `⌘⇧A` all of the same type
- **Move** drag (snaps to guides and an 8px grid; `⌥` for free) · arrows nudge
- **`⇧` locks the axis** while dragging, drawing a dimension, or drawing with the
  pen — horizontal or vertical, whichever you're closer to. `⇧` while resizing
  keeps the aspect ratio, and `⇧`+click still adds to the selection.
- **Resize** by grabbing any edge or corner of a selected block. There are no
  handles to hit: the whole edge is the grab zone and the cursor tells you.
  Selecting something doesn't change how it looks — *Toggle selection outlines*
  in the palette brings the old outline back if you want it.
- **Text** a click on a selected block puts the caret where you clicked; a drag
  from the same spot moves it instead.
- `⌘⇧P` command palette · `⌘K` quick switcher · `/` insert a block
- `⌘G` graph · `⌘⇧O` outline · `⌘\` sidebar · `⌘⇧D` today's daily note
- `⌘Z` undo · `⌘D` duplicate · `⇧⌘G` wrap in a section

## Drafting look

For anything that's a drawing rather than a brainstorm, flip the **Studio /
Drafting** chip in the top bar (or the palette). The look is per page and stored
with it, so a drawing page stays a drawing page.

Drafting mode turns the canvas — and only the canvas — into white paper: the app
chrome stays dark, the way drawing tools have always worked. Shadows and rounded
corners go, borders become hairlines, the grid becomes a real engineering grid
that scales with zoom (minor squares with a heavier line every fifth), and the
palettes swap: no highlighter yellow, just paper tones for cards and ink,
graphite and the standard red/blue/green for lines. New shapes, dimensions and
pen strokes default to ink instead of purple.

### Sheets

*Make this section a paper sheet…* sizes a section to **A0–A4, Letter, Legal or
Tabloid**, portrait or landscape, at true size for the page scale — an A3
landscape at 1 px = 1 mm is exactly 420 × 297 canvas px. Exporting that section
produces a PDF whose page really is A3 (1191 × 842 pt), not a rectangle that
happens to look about right.

### Title block

Insert a **title block** (`/` → Title block) for the usual corner panel: project,
drawing, drawn/checked, date, revision, sheet. The scale field fills itself in
from the page's units and updates when you change them.

## Drafting

Press `M` and drag between two points: you get a real dimension — extension
lines, arrowheads, and a measurement that snaps to the corners, edge midpoints
and centres of whatever is nearby. Drag its endpoints to re-measure, drag the
middle grip to move the dimension line, and it always lands on the outside of
the part the way a drawing expects.

**Units and scale** live on the chip in the top bar (also under the ruler tool,
and in the palette as *Document units and scale*). Pick from `px`, `mm`, `cm`,
`m`, `in`, `ft`, `yd`, `pt` or `thou`, set how many units one canvas pixel is
worth, or take a preset (1:1 through 1:100). Switching units converts the scale
rather than silently changing what the drawing means — 400 mm stays the same
length when it becomes 15.7 in. Every dimension on the page re-reads itself
immediately.

**Dimensions drive the drawing.** Click any dimension's number and type a new
one: the geometry moves to match, and if the dimension spans a block edge-to-edge
that block is resized. Type `250` on a dimension across a 400 mm plate and the
plate becomes 250 mm. Type text instead of a number (`Ø12 THRU`, `TYP.`) and it
becomes a label override; clear it to go back to the measured value.

## PDF

Sections are the unit of output — each one is its own drawing:

- **Section → PDF** (`⌘P`, or the button in the inspector when a section is selected)
- **All sections → PDF** — one page per section, in reading order: a drawing set
- **Whole page → PDF** (`⌥⌘P`)

Page size comes from the section's size on the canvas (canvas px at 96dpi →
points), so a section drawn to a scale prints at a predictable physical size no
matter how far the app had to zoom to capture it. PDFs default to a **white
background** — *Toggle PDF background* switches to dark, and near-white ink is
darkened automatically so it stays visible on the page.

## Interop

*File → Export as .canvas* writes [JSON Canvas 1.0](https://jsoncanvas.org) —
Obsidian's open canvas format. Drop the file in an Obsidian vault and it opens
there; *Import .canvas* reads files written by Obsidian (headings become note
titles, `- [ ]` lists become real checklists, preset colours become stickies,
groups become sections). Round-tripping through this app is lossless — we keep a
private key alongside the spec fields. There's also *Export as Markdown*.

## Code map

```
main.js              Electron main: window, menu, vault + file I/O over IPC
pdf.js               minimal dependency-free PDF writer (JPEG → pages)
preload.js           the whitelisted `window.api` bridge
renderer/
  index.html         DOM skeleton — sidebar / stage / toolbar / overlays
  css/app.css        all styling; colour tokens at the top
  js/util.js         geometry, ids, stroke smoothing, palettes
  js/markdown.js     markdown + [[wikilinks]] + #tags + callouts
  js/store.js        document model, undo/redo, autosave, search, tags, links
  js/nodes.js        block factories + how each block type renders
  js/commands.js     one command registry behind palette / slash / shortcuts
  js/arrange.js      sections, align, distribute, tidy, snap guides
  js/linking.js      [[ ]] autocomplete, slash menu, daily notes, embeds
  js/jsoncanvas.js   JSON Canvas 1.0 reader/writer
  js/cad.js          dimensions, units, drawing scale, paper sizes, snapping
  js/arrows.js       arrows: pinned or loose ends, shapes, heads, labels
  js/export.js       PDF capture flow (per section, per page)
  js/canvas.js       camera, painting, every pointer gesture
  js/comments.js     comment pins and threads
  js/sidebar.js      pages, search, backlinks, unlinked mentions, tags
  js/inspector.js    selection panel + pen options
  js/graph.js        force-directed vault graph
  js/panels.js       minimap + outline
  js/app.js          bootstrap: editing, keyboard, paste, chrome
```

Mutations go `store.beginChange()` → mutate → `store.commit()`; that's what makes
undo and autosave work. A new block type needs: a factory case in
`nodes.js:create`, a render case in `nodes.js:inner`, a `contentKey` case, CSS,
and a line in `commands.js:build`.

## Not there yet

Real-time collaboration, nested sections, and mobile.

PDF and PNG export rasterise: the app frames each section in the window and
captures it, so output resolution is bounded by the window size (retina gives
2x, and we cap magnification at 2x, so a small section exports at up to ~4x its
canvas size). Text in a PDF is therefore an image, not selectable type. Vector
PDF output would mean re-rendering the canvas as PDF drawing operators rather
than capturing it — worth doing if you want true CAD output.

Dimensions measure straight distances only — no angular, radial or chained
dimensions yet.
