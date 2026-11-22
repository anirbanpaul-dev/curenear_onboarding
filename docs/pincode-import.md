# Importing the PIN code directory

`pin_codes`, `districts` and `states` are populated from the **official India Post
PIN code directory** published on data.gov.in. Nothing is embedded in this
repository, invented or copied from a third party: run the import against the
file you download.

## Where to download it

- Data catalogue: <https://www.data.gov.in/catalog/all-india-pincode-directory>
- Direct CSV (all India, ~154k office rows):
  <https://www.data.gov.in/sites/default/files/all_india_pin_code.csv>
- The same directory is also served as an API:
  <https://api.data.gov.in/resource/5c2f62fe-5afa-4119-a499-fec9d604d5bd>

The CSV is published under the Government Open Data License – India. Save it
outside version control, for example `data/all_india_pin_code.csv` (`data/` is
git-ignored).

Expected columns in that file:

| Column in the file | Field |
|---|---|
| `pincode` | PIN code (6 digits) |
| `officename` | Office name |
| `Districtname` | District |
| `statename` | State / union territory |
| `Deliverystatus` | `Delivery` or `Non-Delivery` (used to pick the representative office) |

Some releases also carry `latitude`/`longitude` (the "with contact details and
latitude/longitude" resource). If those columns are absent the import stores
`NULL` coordinates and warns about it.

## Which columns feed which field

Column names are data, not code. The built-in default
(`indiaPostPincodeMapping` in `packages/db/src/pincode-import.ts`, used by both
the CLI and the browser upload) is:

```json
{
  "delimiter": ",",
  "columns": {
    "pinCode": "pincode",
    "officeName": "officename",
    "district": "Districtname",
    "state": "statename",
    "latitude": "latitude",
    "longitude": "longitude"
  },
  "preferredRow": { "column": "Deliverystatus", "equals": "Delivery" }
}
```

For another release or another source, save a JSON file in that shape and pass
it to the CLI with `--mapping <file>` — no code change is needed. Only
`pinCode` and `officeName` are required: `district`, `state`, `latitude`,
`longitude` and `preferredRow` may be omitted or set to `null`, and a mapped
column missing from the file is left empty with a warning. Header matching is
case-insensitive.

## Running it

```bash
pnpm db:seed                                   # states must exist first
pnpm import:pincodes data/all_india_pin_code.csv
pnpm import:pincodes data/all_india_pin_code.csv --dry-run
pnpm import:pincodes data/all_india_pin_code.csv --batch-size 1000
```

Flags:

- `--mapping <file>` — column mapping JSON overriding the built-in India Post mapping.
- `--dry-run` — parse and validate, report the counts, write nothing.
- `--batch-size <n>` — rows per database batch (default 500).

`DATABASE_URL` comes from `.env` at the repository root, or from the environment.

## What it does

1. Parses the CSV (quoted fields, CRLF and a UTF-8 BOM are handled).
2. Groups rows by PIN code. A PIN usually has several offices; the delivery
   office wins, otherwise the first row does.
3. Matches `statename` to a seeded state, ignoring case, punctuation and
   `&`/`and` (so `ANDAMAN & NICOBAR ISLANDS` matches
   `Andaman and Nicobar Islands`). States are never created by the import —
   rows for an unknown state are skipped and the state names are printed so the
   seed list can be extended.
4. Creates any missing districts under the matched state.
5. Upserts `pin_codes` by PIN code.

### Idempotency and counts

The import is idempotent: re-running the same file reports the same rows as
`unchanged` and writes nothing. It prints:

| Count | Meaning |
|---|---|
| `rows read` | Data rows in the file |
| `unique PINs` | Distinct PIN codes after grouping |
| `added` | New `pin_codes` rows |
| `updated` | Existing rows whose office, district, state or coordinates changed |
| `unchanged` | Existing rows identical to the file (no write) |
| `skipped` | Invalid PIN, missing office/state, unknown state, or a second row for a PIN |
| `districts new` | Districts created |
| `states matched` | States that had at least one row |

Skip reasons are printed with their counts so a partial match is obvious.

## Uploading from the browser

Administrators can run the same import without a terminal:
**Admin → Master data → PIN codes → Import the directory**. Choose the CSV,
tick **Validate only** for a dry run, then **Import PIN codes**. The panel shows
the same counts as the CLI (added, updated, unchanged, skipped with reasons,
districts created, states matched) and refreshes the status cards on success.

The file is limited to 25 MB and must end in `.csv`. The upload uses the
`indiaPostPincodeMapping` defaults from `packages/db/src/pincode-import.ts`; for
a different release the CLI's `--mapping` flag takes a JSON mapping, so no
deploy is needed. Every non-dry-run upload writes a `master_data.imported` audit row that
names the uploaded file and its counts (added, updated, skipped) but no row
data.

## After importing

The directory is read-only in the portal: administrators search it in
**Admin → Master data → PIN codes**, which also shows the import status (rows,
districts and the last update). Corrections belong in the source file and a
re-upload, not in the UI.

Staff territory PINs are then picked from this directory (search by PIN or
office name in the staff drawer). A six-digit code the directory does not know
can still be added, so onboarding is never blocked before the first import.
