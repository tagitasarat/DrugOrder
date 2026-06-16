# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

A drug-ordering / inventory-reorder system for a Thai pharmacy chain
("พระจันทร์เภสัช" – Phra Chan Pharmacy), used by branch staff to build daily
purchase orders and by the owner to oversee all branches. The entire
application is a **single self-contained file**: `index.html`.

The UI language is **Thai**. Keep all user-facing strings in Thai and match
the existing tone (informal, emoji-prefixed labels like `➕ เพิ่ม`, `📦 รอของ`).

## Repository layout

```
index.html      ← the entire app: HTML + CSS + JS + embedded data (~1.9 MB)
```

There is **no** build system, package manager, bundler, test suite, linter,
or config file. There are no dependencies to install. The only external
runtime asset is the Google Fonts "Sarabun" stylesheet loaded via `<link>`.

`index.html` is structured in three regions:

| Lines (approx) | Region | Contents |
|----------------|--------|----------|
| 1–159  | `<style>` | All CSS, using CSS custom properties under `:root` (`--pri`, `--acc`, `--grn`, etc.) |
| 160–347 | `<body>` markup | Branch-select screen, PIN modal, main `#app`, modals (history, print, log, scan) |
| 348–1492 | `<script>` | All application logic + embedded data tables (`CAT`, `SALES`, `BC`) |

Note: lines are **very long** (single-line minified data objects up to ~30k
chars). Use `grep`/`Grep` with line numbers and `awk 'NR==N{print substr($0,1,N)}'`
to inspect; do not try to read whole data lines into context.

## Running / previewing

Open `index.html` directly in a browser, or serve it:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/index.html
```

Camera barcode scanning requires a secure context (https or localhost) and a
browser that supports the `BarcodeDetector` API; otherwise the manual
barcode-entry fallback is used.

## How the app works

### Boot
At the end of the script (~line 408) the order-date input is defaulted to
today and `renderBS()` draws the branch-select screen. Everything else is
event-driven from `onclick`/`oninput` handlers wired inline in the markup.

### Roles & access
- **Branch user**: picks one of `BRANCHES` (`สาขา 1`…`สาขา 5`) and works on
  that branch only.
- **Owner**: enters via the PIN modal. `OWNER_PIN = '1234'` (hardcoded,
  client-side). Owner sees per-branch tabs (`renderOTabs`) and can switch the
  viewed branch (`switchView`), mark items ordered, set recommended
  quantities, and order across multiple branches at once.

Key state globals: `curBranch`, `isOwner`, `viewBranch`, `orders` (per-branch
arrays of items), `log`, `selDrug`, `statusFilter`. Use `activeBranch()` to
get the branch currently in view regardless of role.

### Order lifecycle (item `status`)
1. `รอสั่ง` (to order) – item added to the list.
2. `รอของ` (ordered, awaiting goods) – owner pressed "สั่งแล้ว"
   (`markOrdered` / `markAllOrdered`), `orderedAt` timestamp set.
3. **Received** – item removed from `orders` (`receiveItem` / `receiveAll` /
   barcode auto-receive in `handleRecvBarcode`).

The status tab filter is `statusFilter` (`setStatusFilter`), and the left
card swaps between "add item" (รอสั่ง) and "receive search" (รอของ).

`REORDER_DAYS = 3`: an item already `รอของ` can be re-ordered ("ตามของ")
only after this many days (`showDupWarning` / `doReorder`). Duplicate adds are
detected up front (`checkRecentOrder`, `loadRecentOrdered`).

### Embedded data tables (top of `<script>`)
- `CAT` — drug catalog (~9,000 entries), keyed by code `"P-XXXX"`:
  ```js
  "P-5966": {
    n: "CHRONOL 500 mg",          // name
    u: "แผง",                      // unit
    ds: "บริษัท ...",              // default supplier
    sups: [                        // suppliers, each with purchase history
      { s: "บริษัท ...",
        h: [["21/02/26", 25, "1", 33746.93, "GR-01-26-145"]] }
        //   [date,        qty, branch, price,    GR-ref]
    ]
  }
  ```
- `SALES` — recommended order qty per code per branch: `{ "P-2624": { "1": 14, "2": 15, ... } }`
  (branch key is the branch number as a string). Surfaced as the "แนะนำ"
  badge and used by `useRec` / `setLastQtyAll`.
- `BC` — `{ bc: { "<barcode>": "P-XXXX" }, gen: { "<generic>": ["P-..."] } }`
  (~8,500 barcodes). Drives barcode lookup and generic-name search.

This data is a snapshot generated/exported elsewhere (commits are "Add files
via upload"). Treat `CAT`/`SALES`/`BC` as machine-generated; do not hand-edit
individual entries unless explicitly asked.

### Backend (Google Apps Script + Google Sheets)
All persistence goes through one Google Apps Script web-app endpoint stored in
`SCRIPT_URL` (also hardcoded inside `api()`, `loadFromSheet()`,
`loadRecentOrdered()` — keep the three in sync if it ever changes).

- Writes: `api(payload)` does `fetch(..., {method:'POST', mode:'no-cors'})`.
  Because of `no-cors`, **responses are opaque** — writes are fire-and-forget;
  success/failure cannot be read back, only assumed. Actions:
  `add`, `delete`, `ordered`, `qty`, `received`, `reorder`
  (`sheetAdd`, `sheetDelete`, `sheetOrdered`, `sheetQty`, `sheetReceived`,
  `sheetReorder`).
- Reads: `loadFromSheet(branch)` (`action=load`) and
  `loadRecentOrdered(branch)` (`action=loadRecent`) are GET + `.json()`,
  both fall back to empty on error.
- Each item has a client-generated `rowId = Date.now()+'-'+random` used to
  correlate local rows with sheet rows. On `enterApp`, existing local orders
  for the loaded branches are cleared and rebuilt from the sheet to avoid
  duplicates. Input is locked during load via `setAddLock` / `isLoading`.

### Other notable features
- Search dropdown over `CAT` by code, name, supplier, and generic name, with
  keyboard navigation (`si` input handlers, `renderDrop`, `pickDrug`).
- Clipboard copy and CSV export per supplier and for all
  (`copySupplier`/`exportSupplier`/`copyAll`), grouped by supplier.
- Print view (`openPrint`) and per-branch history/log (`showHist`/`openLog`).
- Custom (off-catalog) items via `addCustom` — flagged `custom:true`,
  code does not start with `P-`.

## Conventions to follow

- **Single file, no tooling.** Keep everything in `index.html`. Match the
  existing style: terse vanilla JS, short function/variable names, inline
  `onclick` handlers, no frameworks, no ES modules.
- **Always escape interpolated values** when building HTML strings. Use the
  existing helpers: `esc()`/`escHtml()` for text content, `ea()`/`escAttr()`
  for attribute values. Most rendering builds HTML via template strings, so
  this is the primary XSS guard — do not interpolate raw user/sheet data.
- **Thai everywhere** for user-facing text, including `toast()` messages and
  status values. Status strings (`'รอสั่ง'`, `'รอของ'`) are used as data — do
  not translate or alter them.
- **Re-render, don't patch the DOM by hand.** After a data change, call
  `renderOrder()` (or `renderOrderKeepScroll()` to preserve scroll position,
  and `renderOTabs()` when owner) so the DOM always matches the data model.
- **Keep local state and the sheet in sync.** Any mutation of `orders[...]`
  that should persist must also call the matching `sheet*()` action with the
  item's `rowId`.
- **Dates**: order date input is ISO (`YYYY-MM-DD`); sheet timestamps use
  `toLocaleString('th-TH')`; catalog history dates are `DD/MM/YY` (Buddhist
  year, two digits) and parsed by `parseThaiDate`.

## Git workflow

- Develop on the designated feature branch; create it locally if missing.
- Commit with clear messages; push with `git push -u origin <branch>`.
- Do **not** open a pull request unless explicitly asked.

## Known sharp edges (be careful)

- `OWNER_PIN` and `SCRIPT_URL` are committed in client-side source — anyone
  with the page has them. Treat the PIN as a soft gate, not security.
- Writes are `no-cors` and cannot confirm success; UI optimistically assumes
  the write worked.
- The big embedded data objects make `index.html` ~1.9 MB; avoid loading whole
  data lines into context and avoid reformatting them.
