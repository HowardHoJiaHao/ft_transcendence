# Friends, Chat and Notifications

RacketDiction includes a small social layer so buyers and sellers can keep talking after a listing visit. It is not a general social network. Use it to arrange inspections, postage, and repeat purchases.

## 1. Two different conversations

Do not mix these up:

* **Chat Seller** on a product page starts a conversation about that listing. You do not have to be friends first.
* **Friends** is a saved connection to another member. From the friends list you can open chat again, see online status, or remove the friend.

Both use the built-in realtime chat, not WhatsApp.

## 2. Adding a friend

* Open the other person’s profile (`/user/[id]`), for example from a listing or a search result.
* Use **Add friend**.
* You should see a confirmation toast. The other person gets a notification that you added them.
* Open **Friends** in the header to see the list, avatars, and whether they are currently online.

You must be signed in. You cannot add friends while suspended.

## 3. Managing friends

* **Friends** (`/friends`) shows everyone you have added.
* **Delete friend** removes them from your list. It does not automatically erase every old chat message on the server.
* Removing a friend is for you; it is not a platform ban.

## 4. Chat

* Open **Chat** from the header or from a friend row.
* Messages are delivered over a live WebSocket connection and stored so you can reload the thread later.
* Use chat to:
  * Ask for extra photos of the cone, grommets, or grip
  * Agree a hall, MRT station, or postage amount
  * Confirm that a cart order is the same frame you inspected
* Do not use chat for spam, phishing links, or to push someone into paying outside the platform in a way that hides the deal.

If a conversation is deleted in the UI, that only removes that thread from your chat list according to the chat tools. It does not reverse an order.

## 5. Notifications

The bell in the header collects events such as:

* New chat messages
* Someone added you as a friend
* A buyer placed an order on your listing
* A seller marked your order delivered
* A new review on your listing

Unread counts appear on the bell. Open the panel to jump to the related page. If notifications fail to load, use **Retry**.

## 6. Safety in chat

* Keep the negotiation here so you have a record.
* Never send your password, OTP, Stripe card number, or API key in chat — including to someone who claims to be support or RacketBot.
* RacketBot is a separate assistant. It cannot send chat messages as you or read another user’s private threads.
* Harassment, hate speech, and sexual content in chat are not allowed and can lead to suspension.

## 7. Online status

* Friends list and some chat views show whether the other member currently looks online.
* Online is a live hint only. A seller who is offline may still reply later. Do not treat it as proof they will appear at a meet-up.
