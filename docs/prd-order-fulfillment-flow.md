# PRD: Order Fulfillment Flow

Status: **Proposed / Implementing**

## 1. Problem / goal

Checkout currently creates `pending` orders and marks listing stock/status as
sold, but the marketplace flow stops there:

- Buyers cannot see what they bought.
- Sellers cannot see what they need to deliver.
- There is no app function that changes `orders.status` from `pending` to
  `completed`.
- Seller analytics only count `completed` orders, so checkout alone does not
  update Sales Trends or revenue charts.

The goal is to complete a v1 purchase lifecycle:

1. Buyer checks out.
2. Buyer sees the order under `/cart` → **My Purchases**.
3. Seller sees the order under `/profile/my-ads` → **Pending Orders**.
4. Seller marks the order delivered.
5. Order becomes `completed`.
6. Seller analytics update because the existing analytics queries count
   completed orders.

## 2. Product decisions

- Checkout remains `pending`.
- Seller action changes `pending` to `completed`.
- For v1, "sent", "delivered", and "completed" are the same state.
- No separate `shipped` status, tracking number, shipping address, refund UI, or
  cancellation UI is added in this pass.
- Stock is not changed during completion because checkout already decrements
  stock and marks the listing `sold` when stock reaches zero.

## 3. Buyer experience

Route: `/cart`

Add tabs:

- **Cart** — current cart and checkout flow.
- **My Purchases** — authenticated buyer order history.

My Purchases should show:

- item image/title
- seller name
- quantity
- total price
- order date
- status badge

Status labels:

- `pending` → "Seller preparing"
- `completed` → "Delivered / Completed"
- `cancelled` → "Cancelled"
- `refunded` → "Refunded"

If the user is not logged in, My Purchases prompts them to log in instead of
fetching orders.

## 4. Seller experience

Route: `/profile/my-ads`

Add a tab between **Published** and **Sold**:

- **Pending Orders (n)**

Pending Orders should show:

- item image/title
- buyer username/email
- quantity
- total price
- payment method
- order date
- status badge
- **Mark as Delivered** button

On successful completion:

- remove the order from Pending Orders
- refresh sold listings
- refresh or invalidate analytics data
- Sales Trends, Total Revenue, Sales by Category, and My Items should update
  because the order is now `completed`

## 5. Backend API

### 5.1 Buyer order listing

Keep:

```http
GET /api/v1/orders
```

Add optional filter:

```http
GET /api/v1/orders?status=pending
```

Return enriched order rows with:

- order fields
- listing title/image/category
- seller name

### 5.2 Seller pending orders

Add:

```http
GET /api/v1/seller/orders?status=pending
```

Auth required. Seller ID comes from JWT.

Return enriched order rows with:

- order fields
- listing title/image/category
- buyer username/email

### 5.3 Complete order

Add:

```http
PUT /api/v1/orders/:id/complete
```

Rules:

- Auth required.
- Only the order seller can complete the order.
- Only `pending` orders can become `completed`.
- If no matching pending order exists, return a clear error.

Update:

```sql
UPDATE orders
SET status = 'completed', updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND seller_id = $2 AND status = 'pending'
```

## 6. Acceptance criteria

- Buyer checkout creates a `pending` order.
- Buyer sees the order in `/cart` → My Purchases as "Seller preparing".
- Seller sees the order in `/profile/my-ads` → Pending Orders.
- Seller clicks **Mark as Delivered**.
- Order status becomes `completed`.
- Buyer sees "Delivered / Completed".
- Pending Orders count decreases.
- Seller analytics update after completion:
  - Total Revenue
  - Sales Trends
  - Sales by Category
  - My Items sold/revenue fields
- A seller cannot complete another seller's order.
- A completed order cannot be completed again.
