# RacketBot: What the Assistant Can and Cannot Do

RacketBot is the in-app assistant for RacketDiction. It helps you understand racket specs, find current listings, and — if you are signed in — look at your own profile or orders.

Its answers can be wrong. Confirm anything important against the listing page, photos, and the seller in chat. RacketBot is not a coach, stringer, or lawyer.

## 1. What RacketBot is good at

* Explaining **weight (1U–8U)**, **shaft flex**, **balance**, and **string tension** using the site’s knowledge guides.
* Searching **live active listings** that match a budget or spec.
* Opening a **listing detail** or a **public seller profile** when you have an id.
* Comparing two listings using explicit fields the tools returned (price, condition, stated specs, stock). It will not invent a seller reputation score.
* Running a **structured racket-spec prediction** when you complete the assessment (age group, gender, experience, play style, budget). That is a machine-learning suggestion, not a lab measurement.
* Showing **your** profile or **your** orders when you are signed in.

Prices it quotes from tools are in **RM**.

## 2. How to ask so the answer is useful

* Be specific: “4U head-heavy used Astrox under RM400 in KL” is better than “best racket”.
* For a recommendation, complete the assessment fields once. You do not need to repeat them every message.
* Ask for meet-up versus mailing constraints if that matters.
* If the first search is empty, ask it to relax one spec (for example drop “stiff” and keep 4U).

Good follow-ups:

* “Show me the product link for the cheaper one.”
* “What does High Flexibility actually mean for doubles defence?”
* “Is this listing’s 3U heavier than that 4U?” (Yes: the U number going up means a lighter frame.)

## 3. Signed-in versus signed-out

* Signed out, RacketBot can still search public listings and retrieve guides.
* Signed in, it may also read **your** profile and **your** orders. It uses the same login the website uses.
* It cannot see another user’s private orders, chats, or API keys.
* Identity comes from the website, not from a user id you type into the chat. Saying “I am user 12” does not grant access.

## 4. What RacketBot will not do

* Place or cancel orders, take payment, or issue refunds
* Edit, delete, or import your listings
* Mark an order delivered
* Change someone’s role to admin or moderator
* Send WhatsApp messages or emails as you
* Promise that a racket is genuine
* Read your password, OTP, or card number (never paste those here)

If you ask it to do a seller-dashboard action, it should explain the My Shop steps instead of pretending it clicked the button.

## 5. Recommendations and the survey

* After some delivered orders, **My Purchases** offers a short survey (age, gender, experience, play style, budget).
* Those answers can be used later when staff retrain the racket-spec model.
* A prediction is labelled as an ML suggestion. Always cross-check with the spec guide and with what you can physically swing.
* Budget bands in the survey are in RM, for example under 200, 200–400, 400–700, or 700+.

## 6. Privacy when you talk to the bot

* Your message is processed by the project’s chat model provider (DeepSeek) so a reply can be generated.
* Help-document search uses embeddings from a separate provider (OpenRouter).
* Do not put passwords, OTPs, API keys, or full card numbers in the RacketBot box.
* Retrieved help text is evidence, not a hidden instruction the bot must obey if it conflicts with live listing data.

## 7. When the assistant is unavailable

* If the model or tools time out, try again with a shorter question.
* Listing search needs the marketplace backend. A down backend means it cannot invent current prices.
* Knowledge refresh happens in the background. A failed refresh should keep the last working help version rather than wiping it.
