# PRD: Checkout and Inventory

Status: **Proposed**

## 1. Problem / goal

The `/cart` page currently lets users view cart items, change quantities, remove
items, and clear the cart, but the **Checkout** button does not do anything.
There is also no backend route that creates orders.

Checkout cannot be implemented as a frontend-only action because it changes
database state:

- It creates one or more `orders`.
- It reduces available inventory.
- It may change a listing from `active` to `sold`.
- It affects seller analytics, which read from `orders`.

The goal is to add a safe v1 checkout flow with inventory protection, without
overbuilding a separate inventory subsystem before the marketplace needs it.

## 2. Current state

- Cart state lives in browser `localStorage` through `CartContext`.
- `/cart` displays cart items and totals, but the checkout button has no
  handler.
- `API_DOCUMENTATION.md` lists `POST /api/v1/orders`, but the backend does not
  implement or register it.
- `backend/orders.go` only supports:
  - `GET /api/v1/orders`
  - `GET /api/v1/orders/:id`
- `listings` has `status` (`active`, `sold`, `archived`) but no stock/inventory
  column.
- Product detail pages allow arbitrary quantity increments without checking
  stock.

## 3. Product decision

For v1, inventory should live directly on the `listings` table:

```sql
stock_quantity INT NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0)
```

Reasoning:

- In this codebase, `listings` already represents the sellable thing.
- The app does not currently have SKUs, product variants, warehouses,
  reservations, stock audit history, or fulfillment locations.
- A separate `inventory` table would add complexity without solving a current
  product need.

A dedicated inventory table can be introduced later if the marketplace evolves
into multi-SKU or warehouse-style stock management.

## 4. Scope

### In scope

- Add `stock_quantity` to listings.
- Let sellers set stock when creating or editing a listing.
- Show stock on product detail pages.
- Prevent adding more than available stock from product detail where possible.
- Revalidate cart items during checkout.
- Implement authenticated `POST /api/v1/orders`.
- Create multiple order rows from one cart checkout when the cart contains
  multiple listings.
- Decrement listing stock transactionally.
- Mark a listing `sold` when stock reaches zero.
- Clear cart after successful checkout.
- Return useful checkout errors for out-of-stock or unavailable listings.

### Out of scope for v1

- Real payment gateway integration.
- Payment capture, refunds, payouts, platform fees, or invoices.
- Backend-persisted carts.
- Inventory reservations before checkout.
- Multi-location inventory.
- Stock audit history.
- Partial shipment or delivery tracking.
- Buyer/seller order-management UI beyond the existing order read endpoints.

## 5. User experience

### 5.1 Seller creates/edits listing

Add a **Stock quantity** field to the sell form.

Rules:

- Required for new listings.
- Integer only.
- Minimum `1` when creating an active listing.
- Existing listings default to `1` after migration.
- If stock is set to `0`, listing should not be treated as purchasable.

### 5.2 Buyer views product

Product detail should show available stock.

Behavior:

- If `stock_quantity > 0` and `status = active`, buyer can select quantity up to
  available stock.
- The `+` quantity button is disabled at available stock.
- If stock is `0` or listing is not `active`, disable **Add to Cart** and show an
  unavailable/sold state.
- Buyer should not be able to buy their own listing.

### 5.3 Buyer checks out from cart

On `/cart`, clicking **Checkout**:

1. Requires login.
2. Sends cart listing IDs and requested quantities to the backend.
3. Shows a loading state while checkout is processing.
4. On success:
   - clears local cart
   - shows success message
   - optionally links to order history later
5. On failure:
   - keeps cart intact
   - shows a clear error message
   - identifies unavailable/out-of-stock items when possible

## 6. Data model changes

### 6.1 listings

Add:

```sql
stock_quantity INT NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0)
```

Implementation locations:

- `db/init.sql` for fresh databases.
- `backend/db.go` runtime migration for existing Docker volumes.

Suggested migration:

```sql
ALTER TABLE listings
ADD COLUMN IF NOT EXISTS stock_quantity INT NOT NULL DEFAULT 1;

ALTER TABLE listings
ADD CONSTRAINT listings_stock_quantity_nonnegative
CHECK (stock_quantity >= 0);
```

Note: PostgreSQL does not support `IF NOT EXISTS` for named constraints in the
same way as columns. The runtime migration should avoid failing if the
constraint already exists.

### 6.2 orders

The existing `orders` table is enough for v1 because it already stores:

- `buyer_id`
- `seller_id`
- `listing_id`
- `quantity`
- `total_price`
- `status`
- `payment_method`

No schema change is required for v1 checkout.

## 7. API design

### 7.1 Create checkout orders

`POST /api/v1/orders`

Authorization: required.

Request:

```json
{
  "items": [
    {
      "listingId": 1,
      "quantity": 2
    }
  ],
  "paymentMethod": "meetup"
}
```

Response:

```json
{
  "orders": [
    {
      "id": 123,
      "buyerId": 9,
      "sellerId": 1,
      "listingId": 1,
      "quantity": 2,
      "totalPrice": 1560,
      "status": "pending",
      "paymentMethod": "meetup",
      "createdAt": "2026-07-08T00:00:00Z",
      "updatedAt": "2026-07-08T00:00:00Z"
    }
  ],
  "totalPrice": 1560
}
```

Error examples:

- `401 Unauthorized`: user is not logged in.
- `400 Bad Request`: empty cart, invalid quantity, duplicate listing IDs.
- `403 Forbidden`: buyer is trying to buy their own listing.
- `404 Not Found`: listing does not exist.
- `409 Conflict`: listing is sold, archived, inactive, or has insufficient
  stock.
- `500 Internal Server Error`: unexpected database failure.

### 7.2 Existing order reads

Keep existing routes:

- `GET /api/v1/orders`
- `GET /api/v1/orders/:id`

Optional enhancement:

- Add `status` filtering later, because docs mention it but current backend does
  not implement it.

## 8. Backend checkout rules

Checkout must run inside a single database transaction.

For each requested item:

1. Lock listing row:

```sql
SELECT id, seller_id, price, status, stock_quantity
FROM listings
WHERE id = $1
FOR UPDATE;
```

2. Validate listing exists.
3. Validate `status = 'active'`.
4. Validate `stock_quantity >= requested quantity`.
5. Validate buyer is not seller.
6. Compute `total_price` from the database price, not the frontend cart price.
7. Insert an order row with `status = 'pending'`.
8. Decrement `stock_quantity`.
9. If stock becomes `0`, set `status = 'sold'`.
10. Commit once all items succeed.

If any item fails, rollback the full checkout. This avoids half-checkouts where
some orders are created and others fail.

## 9. Payment model for v1

This project does not currently have real payment integration. Therefore
checkout should mean:

> The buyer places an order/reservation and the seller/buyer complete payment
> through the listing's dealing method.

Recommended v1 defaults:

- `payment_method = "meetup"` unless the UI sends another supported value.
- `orders.status = "pending"` after checkout.
- Seller analytics should continue to count only `completed` orders if that is
  the existing dashboard rule.

Important: do not mark orders `completed` automatically unless the product team
wants checkout to mean "sale completed." For a marketplace with meet-up
arrangements, `pending` is safer.

## 10. Frontend implementation details

### 10.1 Type changes

Add `stockQuantity` to product-related interfaces:

- Product listing response type.
- Product detail page type.
- Cart item type if the cart wants to remember last-known stock.

Even if cart stores stock, checkout must still revalidate with the backend.

### 10.2 Sell form

Add state:

```ts
const [stockQuantity, setStockQuantity] = useState("1");
```

Send as:

```ts
stockQuantity: parsedStockQuantity
```

### 10.3 Product page

Use backend `stockQuantity` to cap selected quantity:

- `setQuantity(prev => Math.min(product.stockQuantity, prev + 1))`
- Disable add-to-cart when unavailable.

### 10.4 Cart page

Add `handleCheckout`.

Payload should be derived from cart item IDs and quantities only:

```ts
{
  items: items.map(item => ({
    listingId: item.id,
    quantity: item.quantity,
  })),
  paymentMethod: "meetup",
}
```

The backend must ignore frontend price/title/image for checkout calculations.

## 11. Acceptance criteria

- A seller can create a listing with stock quantity.
- A seller can edit stock quantity.
- Product detail returns and displays stock.
- Buyer cannot select more than available stock on product detail.
- Checkout requires authentication.
- Checkout creates order rows in `orders`.
- Checkout decrements `listings.stock_quantity`.
- Checkout changes listing status to `sold` when stock reaches `0`.
- Checkout rejects insufficient stock with `409 Conflict`.
- Checkout rejects buying your own listing.
- Checkout uses database price, not frontend cart price.
- Successful checkout clears the cart.
- Failed checkout leaves cart untouched.
- Existing product list/detail behavior still works for listings created before
  this change.

## 12. Edge cases

- **Two buyers checkout same last item:** row lock + transaction ensures only one
  succeeds.
- **Cart contains deleted listing:** return `404` or item-level failure message.
- **Cart contains archived/sold listing:** return `409`.
- **Cart has stale price:** backend uses current listing price.
- **Duplicate listing appears twice in payload:** reject or merge before
  processing. Recommended: reject with `400` to keep behavior explicit.
- **Seller checks out their own item:** reject with `403`.
- **Stock changed after item added to cart:** checkout fails with clear
  insufficient-stock message.

## 13. Testing plan

Backend:

- Create order successfully.
- Reject unauthenticated checkout.
- Reject empty `items`.
- Reject invalid quantity.
- Reject duplicate listing IDs.
- Reject own-listing checkout.
- Reject inactive/sold/archived listing.
- Reject insufficient stock.
- Verify stock decrement.
- Verify status changes to `sold` at zero stock.
- Verify transaction rollback when one item in a multi-item checkout fails.

Frontend/manual:

- Create listing with stock `1`.
- Add it to cart.
- Checkout.
- Confirm cart clears.
- Confirm listing stock is `0`.
- Confirm listing status is `sold`.
- Try adding/checking out more than stock and confirm failure UI.

## 14. Rollout plan

Recommended implementation order:

1. Add backend schema/migration and product response support for
   `stockQuantity`.
2. Update seller create/edit listing form.
3. Update product detail quantity limits.
4. Implement transactional `POST /api/v1/orders`.
5. Wire `/cart` checkout button to the new endpoint.
6. Run backend and frontend build checks.
7. Manually verify a full checkout flow through `https://localhost/cart`.

## 15. Future enhancements

- `PUT /api/v1/orders/:id/cancel` that restores stock for pending orders.
- Buyer order history page.
- Seller order management page.
- Payment gateway integration.
- Inventory reservation timeout.
- Stock movement audit table.
- Dedicated `inventory` table if variants/SKUs/warehouses become real product
  requirements.
