# Bulk CSV Listing Import

If you have many similar items (for example a stringing stall clearing old frames, or a shop moving inventory), you can create listings from a spreadsheet instead of filling the Sell form once per item.

The importer lives in two places:

* **My Shop → Import** at `/profile/my-ads/import`
* **Post an Ad → Bulk upload** (same importer, different page chrome)

You must be signed in. A file is limited to **500 data rows**.

## 1. File format

* Use a `.csv` file (comma-separated). Excel, Numbers, and Google Sheets can all export this.
* The **first row must be column names**.
* Header matching is relaxed: case, spaces, and underscores are ignored. `weightCategory`, `Weight Category`, and `weight_category` are treated as the same column.
* Download the official **product-import-template.csv** from the import page and fill that. It already has the right headers and two example rows.

## 2. Required columns

These four headers must exist. A blank cell in any of them fails that row:

* **title** — listing headline. Example: `Yonex Astrox 88D Pro`
* **price** — asking price in RM, a number greater than 0. Example: `450`
* **location** — where the item is. Example: `Kuala Lumpur`
* **dealingMethod** — how it changes hands. Allowed values:
  * `Meet Up`
  * `Mailing or Delivery`
  * `Meet Up, Mailing or Delivery` — this value contains a comma, so wrap it in quotes in the CSV: `"Meet Up, Mailing or Delivery"`

If any required header is missing, the whole file is rejected before preview.

## 3. Optional columns

Blank cells here are allowed. The server or importer then applies a default.

* **description** — free text. Wrap in quotes if it contains a comma.
* **category** — default `Others`. Allowed:
  * Rackets
  * Grips
  * Shuttlecocks
  * Racket Bags & Covers
  * Strings
  * Shoes
  * Apparel
  * Accessories
  * Others
* **condition** — default `Second-hand (Used)`. Allowed: `Second-hand (Used)`, `New`, `Refurbished`
* **weightCategory** — kept only when category is `Rackets`. Default `4U`. Allowed: `1U` … `8U`
* **flexibilityCategory** — rackets only. Default `Medium Flex`. Allowed: `Stiff Shaft`, `Medium Flex`, `High Flexibility`
* **balanceCategory** — rackets only. Default `Even Balance`. Allowed: `Head Heavy`, `Even Balance`, `Head Light`
* **stockQuantity** — whole number, at least 1. Default `1`
* **phoneNumber** — shown on the listing. Example: `0123456789`
* **originalPrice** — optional “was” price, must be greater than 0 if present. Example: `699`

Use the exact allowed strings. An unrecognised category is stored as typed and then matches no home-page filter.

## 4. Photos are not in the CSV

The spreadsheet creates the listing text and specs only. It does not attach images.

After a successful import:

1. Open **My Shop**.
2. Edit each new listing.
3. Upload up to 6 photos there.

Listings without photos sell poorly and look more like clones. Budget time for photos after the file import.

## 5. Preview and errors

* After you choose a file, the page validates every row in the browser.
* Rows with problems are marked in red. Typical messages:
  * title is required
  * price must be a number greater than 0
  * stockQuantity must be a whole number of at least 1
  * originalPrice must be a number greater than 0
  * dealingMethod / location missing
* **Nothing is imported until every visible row is valid.** Fix the sheet and re-upload, or edit the preview if the UI allows a correction.
* When you confirm, the server validates again. If it rejects a row, the page lists `Row N — field: message`.

## 6. After a successful import

* You will see how many products were created.
* Open **My Shop** to add photos, double-check specs, and publish any listing that still needs attention.
* Imported listings belong to your account, same as the Sell form.

## 7. Common mistakes

* Saving as Excel `.xlsx` instead of `.csv`.
* Using `4u` vs `4U` is usually fine (headers are normalised; values should still follow the allowed labels).
* Putting `Meet Up, Mailing or Delivery` without quotes so the CSV splits it into two columns.
* Setting racket specs on a Grips or Shoes row. Those spec columns are ignored unless category is `Rackets`.
* Importing 200 frames and forgetting photos.
* Exceeding 500 rows. Split into two files.
