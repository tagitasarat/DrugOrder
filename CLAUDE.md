# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

A drug-ordering / inventory-reorder system for a Thai pharmacy chain
("พระจันทร์เภสัช" – Phra Chan Pharmacy), used by branch staff to build daily
purchase orders and by the owner to oversee all branches. The app is two
files: `index.html` (all UI + logic) and `data.js` (the large machine-generated
data tables), which `index.html` loads via `<script src="data.js">`.

The UI language is **Thai**. Keep all user-facing strings in Thai and match
the existing tone (informal, emoji-prefixed labels like `➕ เพิ่ม`, `📦 รอของ`).

## Repository layout

```
index.html      ← all UI + logic: HTML + CSS + JS (~80 KB)
data.js         ← machine-generated data tables CAT / SALES / BC (~1.8 MB)
apps-script.gs  ← reference copy of the Google Apps Script backend (not executed from here)
```

There is **no** build system, package manager, bundler, test suite, linter,
or config file. There are no dependencies to install. The only external
runtime asset is the Google Fonts "Sarabun" stylesheet loaded via `<link>`.

`index.html` loads `data.js` first (so `CAT`/`SALES`/`BC` are defined before the
main script runs — classic top-level `const`s are shared across scripts), then
its own `<script>`. It is structured in three regions:

| Region | Contents |
|--------|----------|
| `<style>` | All CSS, using CSS custom properties under `:root` (`--pri`, `--acc`, `--grn`, etc.) |
| `<body>` markup | Branch-select screen, PIN modal, main `#app`, modals (history, print, log, scan) |
| `<script>` | All application logic (the data tables live in `data.js`) |

Note: the data lines in `data.js` are **very long** (single-line minified
objects up to ~30k chars). Use `grep`/`Grep` with line numbers and
`awk 'NR==N{print substr($0,1,N)}'` to inspect; do not try to read whole data
lines into context, and do not reformat them.

## Running / previewing

Must be **served over HTTP** (not opened as a `file://` path), because some
browsers refuse to load `data.js` from `file://`:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/index.html
```

In production the app is opened from a hosted URL, so this is a non-issue
there.

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

### Data tables (in `data.js`)
- `CAT` — drug catalog (~4,660 entries), keyed by code `"P-XXXX"`:
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

This data is a snapshot generated/exported elsewhere. Treat `CAT`/`SALES`/`BC`
as machine-generated; do not hand-edit individual entries unless explicitly
asked. When refreshing the snapshot, update **`data.js`** (the three
`const CAT=…` / `const SALES=…` / `const BC=…` lines), not `index.html`. If the
export tool still emits a monolithic `index.html` with the data embedded, see
"Updating the data snapshot" below before uploading.

### Backend (Google Apps Script + Google Sheets)
`apps-script.gs` in this repo is the **reference copy** of that backend. It is
not executed from the repo — the owner pastes it into the Apps Script editor
bound to the sheet (Extensions → Apps Script → Save). Keep the copy here in
sync whenever the backend changes, so it is never lost with an ephemeral
container and its history is reviewable.

All persistence goes through one Google Apps Script web-app endpoint stored in
the `SCRIPT_URL` constant, which `api()`, `loadFromSheet()`, and
`loadRecentOrdered()` all reference — change it in that one place.

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

- **Two files, no tooling.** All code/markup/CSS stays in `index.html`; only
  the generated data tables live in `data.js`. Match the existing style: terse
  vanilla JS, short function/variable names, inline `onclick` handlers, no
  frameworks, no ES modules.
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

## Where everything lives

There is no local/permanent machine in this setup. Assistants run in a fresh
ephemeral container that clones this repo at session start, so **the GitHub
repo is the only durable store for code and catalog data** — anything not
committed and pushed is lost when the session ends.

| Data | Home | Updated by |
|------|------|------------|
| App code | `index.html` (this repo) | assistant, via PR |
| Catalog snapshot (`CAT`/`SALES`/`BC`) | `data.js` (this repo) | assistant, from the owner's CW export |
| Project guide | `CLAUDE.md` (this repo) | assistant |
| Live orders (จด / สั่ง / รับของ) | Google Sheet "พระจันทร์เภสัช - ประวัติสั่งยา" (`SHEET_ID` in the Apps Script) | the app itself, at runtime |
| Raw CW exports (.xlsx) | a folder on the owner's own computer | the owner |

The raw CW exports are **not** reachable from the container — the owner
attaches the file in chat when a refresh is wanted. Do not assume a local path
or a Drive copy exists; ask for the file.

## Catalog snapshot log

Keep this current whenever `data.js` is regenerated — it is how the next
session knows what is already covered and what to ask the owner to export.

| Updated | Purchase history covers | CAT entries | Notes |
|---------|------------------------|-------------|-------|
| initial import | 01/2026 – 05/2026 | 4,660 | 8,463 history rows; ~8,500 barcodes; 4,354 SALES entries |
| 2026-09-11 | 01/2026 – 09/2026 (branch 3 = the hub, so this covers all branches) | 5,051 | Merged `Spl_RecRet` CW export for สาขา 3, 01/05–11/09/2026: 2,090 GR docs / 6,526 lines, +391 products, history 8,463 → 11,307 rows. `SALES` and `BC` untouched (not in that report). Also repointed 311 products whose default supplier was an internal transfer, and sorted real suppliers ahead of internal ones; 749 still lack any real supplier. |

To check coverage of the current snapshot without reading the huge data lines:

```bash
python3 - <<'EOF'
import re, collections
s = open('data.js', encoding='utf-8').read()
d = re.findall(r'\["(\d{2}/\d{2}/\d{2})",', s)      # history dates DD/MM/YY
c = collections.Counter(x.split('/')[2] + '-' + x.split('/')[1] for x in d)
print(len(d), 'history rows'); [print(k, v) for k, v in sorted(c.items())]
EOF
```

### สาขา 3 is the hub — one export covers every branch

Branch 3 is the central warehouse: it receives from the real suppliers and
then distributes to branches 1, 2, 4 and 5. So the other branches' own
goods-received reports list the *supplier* as an internal transfer
(`พระจันทร์3`, `พระจันทร์2`, …), which is useless when staff are deciding who
to order from.

Consequences:
- **Only branch 3's export is needed** to refresh the catalog. `CAT` is global
  (`ds` and `sups` are per-product, not per-branch), so branch 3's supplier
  data automatically serves every branch.
- Treat `พระจันทร์<n>`, `ไม่ทราบบริษัท` and `คลังยาสำรอง` as **internal, not
  suppliers**. They may stay in `sups` (the history is still informative) but
  must never be a product's default `ds` when a real company is known, and
  they sort last in `sups`.
- A product can only be repointed if a real supplier appears somewhere in its
  history. After the 09/2026 merge, 749 products still default to
  internal/unknown purely because no real supplier has ever been recorded for
  them — a **longer** branch-3 export (further back than 05/2026) is what
  fixes those, not exports from other branches.

### CW export format (`Spl_RecRet`)

One sheet, a nested report rather than a flat table, and **one branch per
file** (the branch is in the header, e.g. "พระจันทร์เภสัช สาขา 3"):

```
บริษัท ... (618  รายการ)                 <- supplier group header
ลำดับ | วันที่(datetime) | GR-00-26-1499 | ... | รับสินค้า | 2040.0   <- document row
      | P-6909 | ชื่อสินค้า | ... | lot | ... | อัน | 40             <- item rows
```

Parsing notes:
- Column 4 of a history entry is the **document total**, repeated on every line
  of that GR — not a unit price. The existing snapshot works the same way.
- The GR prefix encodes the branch: `GR-00`→สาขา 3, `GR-01`→สาขา 1, `GR-02`→สาขา 2.
- Rows may also be `คืนสินค้า` (returns); the 09/2026 export had none, so that
  case is still unhandled — check before assuming.
- Supplier names arrive with noise (`(สำนักงานใหญ่)`, `(ประเทศไทย)`, `(มหาชน)`)
  and must be mapped onto the existing catalog spelling, or the same company
  splits into two groups in the ordering UI. 19 of 105 needed mapping in 09/2026.
- History is capped at the **2 most recent purchases per (product, supplier)**,
  newest first — `hist[0]` must be the latest because `setLastQtyAll` and
  `renderDrop` read it as "จำนวนล่าสุด".
- Product names/units are **not** overwritten from CW: some CW names switch
  Thai→English, which would break staff search. 89 names differed in 09/2026
  and were deliberately left alone.

Reusable scripts from the 09/2026 merge live in the session scratchpad
(`parse_cw.py`, `merge_cw.py`); re-derive them from this section if gone.

### Refresh procedure

1. Ask the owner to export the goods-received report from **CW software** as
   Excel, starting from the last covered month (overlap is fine — dedupe on
   the GR reference) up to today, and to attach it in chat.
2. **Merge, never replace.** Products absent from the new export must survive:
   staff still search for items last received months ago. Add new products,
   append purchase history, refresh `SALES`; never drop an existing `CAT` key.
3. Regenerate only the three data lines in `data.js`; `index.html` is untouched.
4. Verify (`node --check data.js`), report the before/after counts to the
   owner, then update the table above in the same commit.

## Updating the data snapshot

The catalog/barcode data is regenerated periodically and used to be embedded
in `index.html`. It now lives in `data.js`. Two cases:

1. **Export tool emits just the data** (ideal): have it write the three
   `const CAT=…` / `const SALES=…` / `const BC=…` lines into `data.js` and
   upload only `data.js`. `index.html` does not change.
2. **Export tool still emits a whole `index.html`** with the data embedded:
   do **not** upload that file as-is (it would re-merge data into `index.html`
   and undo the split). Instead, extract the three data lines from it into
   `data.js`. The split was done with:

   ```bash
   # given a freshly generated full file as index.full.html, with CAT/SALES/BC
   # on the first three lines after the opening <script> tag:
   S=$(grep -n '^<script>$' index.full.html | head -1 | cut -d: -f1)
   awk -v s="$S" 'NR>s && NR<=s+3' index.full.html > /tmp/newdata.js   # the 3 lines
   # prepend the header comment, then replace data.js with the new lines.
   ```

   Keep `index.html` as the small (~80 KB) UI/logic file and commit only the
   updated `data.js`.

After updating, verify both files parse: `node --check data.js` and extract the
`<script>` body of `index.html` and `node --check` that too.

## Git workflow

- Develop on the designated feature branch; create it locally if missing.
- Commit with clear messages; push with `git push -u origin <branch>`.
- Do **not** open a pull request unless explicitly asked.

## Known sharp edges (be careful)

- `OWNER_PIN` and `SCRIPT_URL` are committed in client-side source — anyone
  with the page has them. Treat the PIN as a soft gate, not security.
- Writes are `no-cors` and cannot confirm success; UI optimistically assumes
  the write worked.
- The data objects in `data.js` are ~1.8 MB; avoid loading whole data lines
  into context and avoid reformatting them. (`index.html` itself is now ~80 KB.)
- Because `data.js` is loaded with a plain `<script src>`, the app must be
  served over HTTP — opening `index.html` as a `file://` path may fail to load
  the data in some browsers.
