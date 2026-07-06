# PRD: Seller Analytics Dashboard

Status: **Draft for review** — no code written yet.

## 1. Problem / goal

Sellers on `/profile/my-ads` can currently only see a flat list of their ads (Published / Sold) with a static views-count. They have no visibility into how their items are actually performing — price vs. units sold, revenue trend over time, or which items are worth relisting/restocking. This feature adds a lightweight analytics layer to that same page so sellers can make better pricing/restocking decisions without leaving the ad management flow.

## 2. Where it lives

- Same route: `/profile/my-ads`
- Same tab bar as the existing `Published (n)` / `Sold (n)` pills — add a third pill: **`📊 Analytics`**
- Clicking it swaps the list below (currently the ad cards) for the two new dashboard components. Published/Sold logic and markup are untouched.

```
[ Published (1) ] [ Sold (0) ] [ 📊 Analytics ]
```

## 3. Scope

Two components, both scoped to **the logged-in seller only** (their own `seller_id`), rendered stacked vertically under the Analytics tab.

### 3.1 Component A — Sales table (per item)

One row per listing the seller has ever sold or currently has active. Columns:

| Column | Source | Notes |
|---|---|---|
| Item title | `listings.title` | links to `/products/:id` |
| Price | `listings.price` | current listing price |
| Units sold | `COUNT(orders.id)` where `listing_id` matches, `status='completed'` | |
| Revenue per unit | `price` (or avg `total_price / quantity` from orders, if price changed over time) | |
| Total revenue | `SUM(orders.total_price)` for that listing | |
| Views (30d) | `listings.views_count` scoped to a rolling 30-day window (see §4) | |
| Status | `listings.status` | active / sold / archived |

Sorting: default by total revenue descending. Client-side sort toggle on columns is nice-to-have, not required for v1.

Empty state: "No sales data yet" if seller has zero orders across all listings.

### 3.2 Component B — Seller monthly summary (per account)

Scoped to the logged-in seller (`seller_id = current user`), aggregated by calendar month.

- **Chart**: bar or line chart, X = month, Y = revenue (RM), last 12 months (or all history if less).
- **Stat tiles above/beside the chart**:
  - Total revenue (all-time, completed orders)
  - Total orders (completed)
  - Total active listings
  - Average rating across seller's listings
- **Table below chart** (optional, nice-to-have): month, order count, revenue — same data as the chart, in tabular form for exact numbers.

Revenue metric = **RM (sum of `orders.total_price` where `status = 'completed'`)**, grouped by `DATE_TRUNC('month', orders.created_at)`.

## 4. View tracking (in scope)

Today `listings.views_count` is **never incremented anywhere in the backend** — it's dead data from seed rows. The mock shows "views in the last 30 days," which we can't produce truthfully without a real, timestamped event log. This PRD scopes in the minimum needed to make that number real:

- On `GET /api/v1/products/:id` (product detail fetch), increment `listings.views_count` **and** insert a row into `analytics_events` (existing but unused table) with `event_type='listing_viewed'`, `user_id` (nullable if anonymous), and a `created_at` timestamp.
- The dashboard's "views in last 30 days" then becomes `COUNT(*)` from `analytics_events` where `event_type='listing_viewed'` and `listing_id` (needs to be added to `event_data` JSON or as a column — see open question below) and `created_at >= NOW() - INTERVAL '30 days'`.
- Guard against view-count inflation from the seller viewing their own listing (skip increment if `userId == seller_id`).

This does **not** include deduplicating repeat views from the same visitor/session — out of scope for v1, first-pass is a simple counter.

## 5. API design (proposed)

New endpoints under the existing `protected` group (JWT-authed, `myMiddleware.JWTAuth()`), following the existing `backend/products.go` / `orders.go` handler style (plain `database/sql` queries, no new module needed — or optionally added as `backend/modules/user/seller/` if we want to match the modular pattern used by auth/profile/friends/chat).

- `GET /api/v1/seller/dashboard/items` → Component A data (per-listing sales rows) for the authenticated seller
- `GET /api/v1/seller/dashboard/summary?months=12` → Component B data (monthly revenue series + stat tiles) for the authenticated seller

Both derive `seller_id` from the JWT (`c.Get("userId")`), same pattern as `getOrders`/`deleteProduct` — no `sellerId` query param needed since it's always "my own data."

## 6. Out of scope (v1)

- Cross-seller / admin-wide analytics
- Payout/fee ledger, net-of-fees revenue
- Deduplicated/unique-visitor view tracking
- Stock/inventory quantity tracking (schema doesn't have it)
- Real-time/live-updating charts (page-load fetch is sufficient)
- Editing the existing duplicate `analytics` table — we reuse `analytics_events` only and leave `analytics` as-is (separate cleanup conversation)

## 7. Open questions before implementation

1. `analytics_events.event_data` is JSON with no indexed `listing_id` column — do we add a proper `listing_id INT` column to `analytics_events` (cleaner, indexable) instead of stuffing it in JSON? *(Recommend: add the column — trivial migration, avoids JSON queries.)*
2. Chart library — does the frontend already have one installed? (Nothing in `package.json` currently — would need to add one, e.g. `recharts`.)
3. Should "Units sold" count `quantity` (if an order can be >1 unit) or `COUNT(orders.id)` (order count)? Schema has `orders.quantity`, so true units sold should `SUM(quantity)`.

## 8. Rollout

Single PR, additive only:
- New migration: add `listing_id` column + index to `analytics_events` (if Q1 resolved as recommended)
- New backend endpoints (read-only, no writes except the view-increment change)
- Frontend: new "Analytics" tab + two components on existing `my-ads` page
- No changes to existing Published/Sold behavior
