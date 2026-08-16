# How to Create an Account and Sign In

RacketDiction accounts are free. You need one to chat with sellers, add friends, check out, sell, import CSV listings, use the Developer API, or ask RacketBot about your own orders.

The site is available in **English**, **Bahasa Melayu**, and **中文**. Language is stored in the browser and does not change your account.

## 1. Register with email and password

* Open **Login** and switch to the register view.
* Provide a username, email, password, and the profile fields the form asks for (name, and any optional phone or date of birth).
* You should be at least 18, or have a parent or guardian’s consent.
* Use an email you can open. Login OTP and email/password changes are sent there (via the project’s mail provider, Brevo).
* After a successful register, sign in. New password accounts are created with a second-step OTP at login.

Do not reuse a password from another site. Do not create extra accounts to dodge a suspension or to fake reviews.

## 2. Sign in with password and OTP

1. Enter the email and password you registered with.
2. If the account requires two-factor login, the site accepts the password and then emails a **6-digit OTP**.
3. Enter the code on the OTP screen.
4. If the email is slow, use **Resend OTP**. There is a short cooldown (about 60 seconds).
5. After a valid code, you receive a session token and land in the marketplace.

If the password is wrong you will not get an OTP. If the account is **suspended**, login is refused even with the right password.

## 3. Sign in with Google

* On the login page, choose Google sign-in.
* Complete Google’s screen. The app receives a basic profile and creates or links the account.
* Email and password for that account are managed by Google. The Profile page will not let you change them on RacketDiction.
* Protect the Google account itself (Google 2-Step Verification, recovery email).

## 4. Changing email, password, or phone

From **Profile** (`/profile`):

* **Change email** and **change password** send an OTP to your current email. Enter that code to finish. Not available on Google-managed accounts.
* **Change phone number** updates the number buyers may see after they order from you. Use 8 to 15 digits, optionally starting with `+`.
* You can also update first name, last name, address, bio, date of birth, and avatar.

Keep the email current. If you lose both the mailbox and Google access, you cannot complete OTP steps.

## 5. Avatar and public profile

* Other users see your username, avatar, listings, and reviews.
* Your email is not a public listing field.
* Phone appears in seller/listing contexts you choose, and may be shown to a buyer on their own order so they can arrange handover.
* Open another member at `/user/[id]` to add them as a friend or view what they have published.

## 6. Sessions and sign-out

* A password login stores a token in the browser.
* Google login may also use a cookie for the OAuth token.
* **Log out** from the header menu. You will need to sign in again to manage listings, chats, and orders.
* Clearing site data signs you out. It does not delete the account.

## 7. Suspended or deleted accounts

* Staff can **suspend** an account that breaks the rules. Suspended users cannot use the marketplace normally.
* A **deleted** account is anonymised. Public leftover rows show as a deleted user, not as your old username and email.
* If you think a suspension is wrong, use the Contact link in the footer. RacketBot cannot unsuspend anyone.

## 8. Admin panel versus member login

* Assigned **admin** or **moderator** members sign in with this same member login, then open **Admin panel** from the header.
* The separate page `/admin/login` is only for the bootstrap administrator credential. Ordinary staff should not need it.
