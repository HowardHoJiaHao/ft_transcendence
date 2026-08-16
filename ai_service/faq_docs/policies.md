# Platform Policies in Plain Language

This page summarises how RacketDiction actually works. The full wording lives on **/terms** and **/privacy**. Those pages are the ones to read if something is in doubt.

RacketDiction is a student project built at 42 Kuala Lumpur. The legal pages describe the running software in good faith. They have not been reviewed by a lawyer and are not legal advice.

## 1. What you can list

You may list badminton and related sporting goods you own (or are allowed to sell), with honest photos and prices.

When you publish a listing you are saying that:

* You can legally sell that item
* The description, condition, price, and photos are not misleading
* You will honour the price and the stock you showed

Staff may hide or remove a listing that appears to break the rules, without notice.

## 2. What you must not list or do

Not allowed:

* Counterfeit goods sold as genuine, stolen goods, or otherwise illegal items
* Fake or reused photos that pretend you have stock you do not have
* Harassment, hate speech, threats, or sexual content in listings, reviews, or chat
* Spam, review manipulation, or extra accounts to dodge a suspension
* Scraping or automated access **outside** the Developer API
* Attacking the site, the WAF, or other users’ data

Clone rackets sold honestly as replicas at replica prices are a different situation from clones titled as current Yonex flagships. If you are unsure, say “replica” in the title and price it like one.

## 3. Orders, money, and refunds

* A completed order is an agreement **between buyer and seller**. The site is not itself the shop that sold the frame.
* Sellers should fulfil confirmed orders and keep status up to date.
* Buyers should pay the agreed amount and give workable meet-up or mailing details.
* **Meet up / COD** money (cash, DuitNow) is not held in escrow by RacketDiction.
* **Stripe checkout** on this project is sandbox / test mode for a demo seller. It does not charge real cards in production-like club use.
* Disputes should start in platform chat. The operators may help where they can. They are not obliged to mediate or to pay a refund.

## 4. Accounts and staff actions

* You are responsible for what happens under your login. Keep passwords and OTPs private.
* **Moderators** and **admins** are assigned roles on a member account. They can review users and suspend or restore accounts.
* Moderators have a narrower set of actions than admins. Role changes are an admin action.
* The bootstrap `/admin/login` account is a separate emergency credential, not your shop login.
* RacketBot cannot promote you, unsuspend you, or delete someone else.

If your account is suspended and you believe that is wrong, use the Contact link in the footer.

## 5. Chat, friends, and RacketBot

* Chat exists to arrange transactions. Messages are stored so threads can reload.
* Do not use chat to phish or to force off-platform payment in order to hide a scam.
* RacketBot can be wrong. It only acts with your permissions. Messages to it are processed by a third-party AI provider (see the Privacy Policy).

## 6. Developer API

* Keys belong to your account. Keep them secret, stay inside rate limits, and expect a key to be revoked if it is abused.
* The public API only serves **your** listings.

## 7. Privacy, in short

The platform collects account fields, OTP/Google sign-in data, profile content, marketplace activity (listings, cart, orders, reviews), chat/friends/notifications, technical logs, and API-key usage.

It does not sell that data. It shares what other users need to see (username, avatar, listings, reviews), what processors need to run a feature (Google, Brevo email, DeepSeek chat, OpenRouter embeddings, Stripe in sandbox), and what the law requires.

Passwords are hashed. OTP codes expire quickly. Clearing browser storage signs you out; it does not wipe the account.

Read **/privacy** for retention, cookies, children’s data, and your rights.

## 8. How to contact a human

* Footer **Contact** link for policy, suspension, or safety reports.
* Attach listing URLs, usernames, chat screenshots, and payment evidence.
* There is not a complete in-app Report button. Do not wait for one if you have evidence of fraud.

RacketBot can point you here. It cannot file the report for you.
