# How Checkout, Cart and Purchases Work

This guide covers the in-app cart, the two checkout methods, and what you see afterwards in **My Purchases**. For browsing and chatting a seller first, see the buyer guide. For meet-up inspection tips, see dealing methods.

## 1. What the cart is for

The cart holds listings you intend to order through the platform.

* Open a product page, choose a quantity that is not higher than the listed stock, and add it to the cart.
* The header cart icon is for signed-in shopping. Checkout requires a session.
* You can change quantity or remove a line before you pay.
* **Clear cart** removes every line locally. It does not cancel an order that already exists.

The cart is stored in the browser. If you switch devices, the same items will not automatically appear.

## 2. Sign in before checkout

* If you are not signed in, checkout sends you to **Login**.
* If your session expired, sign in again so the request can send your member token.
* Suspended accounts cannot complete checkout.

## 3. Payment method: Meet up / COD

This is the everyday option for user-to-user sales.

* On the cart page, choose **Meet up / COD**.
* The site creates one or more **pending** orders (one per seller/listing line as the backend records them).
* The cart then clears and **My Purchases** opens.
* You still have to arrange the actual handover in chat or by the seller phone shown on the purchase.
* Money typically changes hands as cash or DuitNow at the meet-up. RacketDiction does not hold that cash.

Use this when the listing allows meet-up, or when you and the seller already agreed collection details.

## 4. Payment method: Stripe sandbox

The cart also offers **Stripe sandbox card payment**.

* This is **test mode only**. No real money is charged.
* Cards only.
* Every item in the cart must belong to the configured demo seller. Mixed carts from other sellers will not go through this path.
* If checkout is accepted, the site redirects you to Stripe. Complete or cancel the session there.
* After a successful redirect back, wait for the verified webhook. The purchase list updates when payment is confirmed, not merely when the browser returns.
* If Stripe cannot open a checkout URL, the cart is preserved so you can try again.
* If you cancel on Stripe, reserved stock can stay held until that Checkout Session expires.

Do not treat sandbox Stripe as a live national card payment for ordinary club sales. For real-world meet-ups, use Meet up / COD and inspect the item.

## 5. After you place an order

Open **Cart → My Purchases**. Each purchase can show:

* Listing title and image
* Seller name
* Quantity and total price in RM
* Payment method
* Order status
* Payment status for Stripe orders
* Seller phone, when the seller has published one (buyers see this on their own orders)

Typical **order** statuses:

* **Pending Delivery** — created, not yet marked delivered
* **Delivered** — seller marked the order complete
* **Cancelled**
* **Refunded**

Typical **Stripe payment** labels you may see:

* Awaiting confirmation
* Paid
* Card attempt failed — retry in Stripe
* Expired
* Refunded

## 6. Reviews and the recommendation survey

Once an order is delivered:

* You can leave a **listing review** (star rating and optional comment). That review belongs to the listing, not to a separate seller score.
* You may also submit the **recommendation survey** (age group, gender, experience, play style, budget). This helps retrain RacketBot’s racket-spec model. It is optional and is not a product review.

You submit each of those at most once per order.

## 7. Problems at checkout

* Out-of-stock or reduced stock: change the quantity or remove the line.
* Network errors: the cart is usually still there; try again rather than paying a second time in chat.
* Stripe 503 or missing URL: your cart should remain. Try later or use Meet up / COD if that fits the listing.
* Never send a second full payment to a personal account “because checkout failed” without checking **My Purchases** first.
