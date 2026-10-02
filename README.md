# CertBench

A real, full-stack IT certification mock-exam platform:

- **Frontend** — vanilla JS single-page app (`/public`), no build step.
- **Backend** — Node.js + Express (`server.js`, `/src`).
- **Database** — SQLite, using Node's **built-in** `node:sqlite` module. No separate database
  server, and no native module compilation — this avoids the common Windows/Mac "needs
  build tools" error that packages like `better-sqlite3` run into.
- **Auth** — registration, bcrypt-hashed passwords, email one-time-code login, JWT sessions.
- **Grading** — done entirely server-side. Correct answers are never sent to the browser
  until after you submit, and each user can only see their own results.

This is not a demo shell — it's the real thing, tested end-to-end (registration, OTP
verification with both wrong and correct codes, a full 30-question timed exam, server-side
scoring, and cross-user data isolation) before being handed to you.

> **Requires Node.js 22.5 or newer** (for the built-in SQLite support). Check with
> `node --version`. If you're on an older version, download the current LTS from
> https://nodejs.org and reinstall.
>
> You'll see a one-line `ExperimentalWarning: SQLite is an experimental feature` when the
> server starts — that's expected and harmless, not an error.

## 1. Run it locally first

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste into .env as JWT_SECRET
npm run seed        # loads the 6 built-in exams (optional: the server also does this on first start)
npm start            # http://localhost:3000
```

Leave `EMAIL_USER` / `EMAIL_PASS` blank in `.env` for now. Without them, the login OTP is
printed to the **server console** and also shown on-screen in a clearly labeled "no email
provider configured" box, so you can fully test the app before setting anything up.

## 2. Get real email delivery working (free, no billing)

1. Use an existing Gmail account, or create a new free one.
2. Turn on 2-Step Verification on that account (required to create an app password):
   https://myaccount.google.com/security
3. Create an app password: https://myaccount.google.com/apppasswords — choose "Mail" as
   the app. Google gives you a 16-character code (looks like `abcd efgh ijkl mnop`).
4. Put them in `.env` (no spaces in the password):
   ```
   EMAIL_USER=youraddress@gmail.com
   EMAIL_PASS=abcdefghijklmnop
   ```
5. Restart the server. OTPs now go out as real emails, and the on-screen fallback box
   disappears automatically.

This costs nothing and Gmail doesn't ask for billing details to create an app password —
just the account itself. Gmail does cap sending at roughly 500 emails/day on a free
personal account, which is plenty for getting started; if you outgrow that, swap in a
free-tier transactional provider (Brevo, Resend) by setting `EMAIL_HOST` / `EMAIL_PORT` /
`EMAIL_SECURE` in `.env` instead — `src/email.js` is the only file that would need touching.

## 2b. Paid enrollment (Razorpay)

Exams can have a price. As shipped, there are 6 exams: Azure Fundamentals (₹499), AWS
Cloud Practitioner (₹599), Google Cloud Platform Fundamentals (₹499), DevOps & CI/CD
Fundamentals (₹449), Software Testing & QA Fundamentals (₹399), and Kubernetes (free) —
change prices (0 = free, no payment step at all) or add entirely new exams in the admin
panel (section 2i). No code changes or re-seeding needed.

With no `RAZORPAY_*` keys set, clicking "Enroll" completes instantly for free — a dev
fallback so you can build and test the whole enroll → unlock-exam flow with zero signup,
same idea as the OTP dev fallback above.

To take real payments:

1. Sign up at https://dashboard.razorpay.com/signup (email + phone, no business
   documents needed yet).
2. Go to Settings → API Keys → generate **Test Mode** keys first. Put them in `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=your_test_secret
   ```
3. Restart the server. "Enroll" now opens a real Razorpay Checkout window. Pay with
   [Razorpay's published test card numbers](https://razorpay.com/docs/payments/payments/test-card-details/)
   — still no real money moves in Test Mode.
4. When you're ready to accept real money: complete Razorpay's KYC/business verification
   (PAN, bank account, etc. — this is on Razorpay's site, not in this code), then swap in
   your **Live Mode** key pair in `.env`. Nothing else changes.

Payment verification happens server-side (`src/routes/payments.js`) via HMAC signature
check — the client can't fake a successful payment.

## 2c. Practice sets

Each exam now has 5 separate practice sets (30 questions each), drawn from a larger shared
question pool per exam (~49 unique questions) so retaking an exam doesn't mean seeing the
exact same 30 questions again. After enrolling (or immediately, for free exams), the person
picks a set on a new screen before the timer starts; each set tracks its own best score and
attempt count independently.

To add, edit or remove questions, use the admin panel (section 2i): one at a time, or many at
once from a CSV file.

## 2d. Validation rules

Registration enforces (both in the browser and, authoritatively, on the server):
- Name: letters only, 2-80 characters
- Email: standard email format (not restricted to specific providers — Gmail, Yahoo,
  Outlook, work domains, etc. all work; only the *shape* of the address is checked), and
  must not already be registered
- Mobile: exactly 10 digits, must start with 6, 7, 8, or 9 (Indian mobile format)
- Username: 3-32 characters, letters/numbers/dot/underscore, must be unique
- Password: at least 6 characters, must include at least one letter and one number

Adjust the regular expressions in `src/routes/auth.js` (and mirror any change in
`public/app.js`'s `renderRegister`) if your target audience needs different rules — e.g.
international phone numbers instead of a fixed 10-digit Indian format.

## 2e. Search, history, and password reset

- **Search bar** on the exam-selection screen filters by name, description, or short label
  as you type — client-side, no server round-trip.
- **"My results"** (top bar, once signed in) shows every completed attempt across every
  exam and set: date, score, pass/fail, with a summary strip (total attempts, passed count,
  average score).
- **"Forgot password?"** (login screen) emails a 6-digit reset code to the account's email,
  using the same email setup as login OTPs (`src/email.js`). It always returns the same
  generic response whether or not the email is registered, so it can't be used to check
  who has an account. Reset codes and login codes are cryptographically separated (a reset
  code can never be used to log in, and vice versa).

## 2f. Exam-taking UI: question palette, skip, and review

The exam screen now has a left-hand sidebar (RBI/SBI-style "question palette") instead of
a plain progress strip — a clickable grid of question numbers, color-coded:
- **Green** — answered
- **Amber** — explicitly skipped
- **Red** — visited but left blank
- **Gray** — not visited yet

Clicking any number jumps straight to that question. A **"Skip question"** button clears
any selected answer and flags the question, distinct from just navigating past it with
Next. A **"Review & submit"** shortcut is available from any question (not just the last
one) and opens a review screen summarizing answered/skipped/blank counts, with a warning
and confirmation if you try to submit with unanswered questions — final submission only
happens from that screen (except on timer expiry, which still auto-submits immediately).

## 2g. Installable as an app (Android, iOS, desktop)

CertBench is a Progressive Web App (PWA) — once it's deployed somewhere real (see
section 3), anyone visiting it on Android Chrome gets an "Install app" / "Add to Home
screen" prompt. Installing it gives a real home-screen icon, a full-screen window with
no browser bar, and the app shell (HTML/CSS/JS) still opens from cache when you're
offline. When online it always fetches the latest files first, so updates show up on a
normal refresh — only live exam data, login, and payments require an actual connection. The same works on iOS Safari (Share \u2192 Add to Home Screen) and desktop
Chrome/Edge (an install icon appears in the address bar).

This is **not** the same as a native `.apk` file from the Play Store — no separate app
to compile or submit. If you want an actual Play Store listing later, the next step is
wrapping this same code with [Capacitor](https://capacitorjs.com), which produces a real
Android project from a web app like this — but building that `.apk` requires Android
Studio and the Android SDK on your own machine, which isn't something achievable from
this chat. Happy to generate the Capacitor project scaffolding if/when you want to go
that route.

To change the app icon or name, regenerate the files in `public/icons/` and
`public/manifest.json`.

## 2h. Landing page and contact details

Logged-out visitors see a landing page (nav bar, exam list with real prices, "How it works",
"About", "Contact us"). The Sign in / Register buttons open in a new tab on the website;
inside the installed app they navigate in-app instead.

- **Contact details, the banner message and the About text** are edited in the admin panel
  (**Site settings**), see section 2i. No code changes needed.
- **Exam names and prices** on the landing page come from the server (`/api/exams`), so
  they always match what people are actually charged; change them in the admin panel.
- The "How it works" and "About" text is in `renderLanding()` in `public/app.js`.

## 2i. Admin panel (manage certificates, questions and site text without coding)

Open **`/admin`** on your site (e.g. `http://localhost:3000/admin`). It uses your normal
CertBench login, but only accounts you have made admins can get in.

**One-time setup: make yourself an admin.** There are two ways; use whichever your host allows.

*Option A: `ADMIN_EMAILS` (works on any host, no command line needed).* Recommended once the site is live.
1. Make sure email sending is set up (the `EMAIL_*` settings from step 2). This is required:
   without it the site shows login codes on screen, so the setting is ignored for safety.
2. Register on your live site with the email address you want to be the admin.
3. In your host's dashboard (where you put `JWT_SECRET`), add a variable
   `ADMIN_EMAILS=you@example.com`. Several people: separate with commas.
4. Redeploy/restart. The host's logs should show `[ADMIN] ... ADMIN_EMAILS is ON for: you@example.com`.
   If they say `IGNORED`, email isn't configured yet.
5. Sign in and click **Admin** in the top bar (or go to `/admin`).
To remove someone added this way, delete their address from the variable and redeploy (the
Users screen shows which admins come from this setting, since the panel can't change it).

*Option B: `make-admin` (needs a command line on the server; also the easy way on your own computer).*
1. Register a normal account on the site.
2. On the machine that runs the site (the server can keep running), run
   `npm run make-admin -- yourusername`
3. Reload the site and click **Admin**.
To remove: `npm run make-admin -- theirusername --revoke` (takes effect on their very next click).
Note: on Railway, `railway run` executes on *your* computer, not the server, so it would change a
different database. Use Option A there, or a real shell on the running service.

Either way, admin access can only be granted by whoever controls the server or its settings, never
from the website itself.

**What you can do in the panel**
- **Certificates**: add a new one (name, badge, colour, price, time limit, pass mark), edit it,
  publish it, hide it, or delete it. New certificates start **hidden** until you publish them,
  and every one of the 5 sets must have at least one question first.
- **Questions**: add, edit or delete one at a time, or import many from a CSV file
  (columns: `question, option_a, option_b, option_c, option_d, correct` with correct = A-D).
  A "Download template" button gives you a ready-made file. If any row has a problem, nothing is
  imported and you are told exactly which rows to fix.
- **Users**: search every account (name, email, username or mobile), add a user, edit their
  details, set a new password for someone who is locked out, sign them out of all devices,
  make them an admin or remove their admin access, see their enrolments and results, and
  delete their account.
- **Site settings**: the announcement banner, the About text, and the Contact details.
- **Overview**: student/revenue counts and a log of every admin change (who, what, when).

**Removing access or deleting someone** (Users tab):
- *Remove admin access*: open the user, click **Remove admin access**. They stay a normal student
  and lose the admin panel on their very next click.
- *Delete the account*: open the user, type their username in the Delete box, confirm. Their
  account, results and enrolments are removed and they are signed out everywhere immediately.
  (If they paid, the payment itself stays in your Razorpay dashboard.)
- You can't remove your own admin access or delete your own account from the panel, so nobody
  locks everyone out by accident. Another admin has to do it.
- Resetting a password or deleting an account signs the person out on every device at once.
  Students who reset their own password with "Forgot password?" are also signed out elsewhere.

**Safety rules built in**
- Someone in the middle of an exam is graded on exactly the questions they were given, even if
  you edit, add or delete questions while they are taking it.
- Deleted questions are switched off rather than erased, so past results stay intact.
- A certificate that anyone has **paid** for cannot be deleted; use **Hide** instead (students lose
  access while it's hidden, and all payment and result records are kept).
- Deleting needs the certificate's exact name typed in, plus a confirmation.
- Only add questions you wrote yourself or have the right to use. Copying real exam questions
  breaks the certification providers' rules, and the site tells students its questions are original.

**`npm run seed` no longer overwrites your work**
- On an existing database it only **adds** built-in certificates that are missing. It never changes
  one that already exists.
- `npm run seed -- --update` refreshes the built-in certificates from `src/seed.js`, but still skips
  any certificate you have created or edited in the admin panel.
- To start completely fresh, stop the server, delete the `data` folder, then run `npm run seed`.
  This erases all accounts, results and admin changes.

## 3. Put it on the actual internet

The simplest path is a host that runs a persistent Node process with a writable disk (so the
SQLite file survives restarts): **Railway** or **Render** both work. The persistent storage this
needs may require a paid plan on some hosts, so check their current pricing. Without it, every
redeploy starts from an empty database and all accounts and results are lost.

### Railway
1. Push this folder to a new GitHub repo.
2. On https://railway.app → New Project → Deploy from GitHub repo.
3. In the service's Variables tab, add `JWT_SECRET`, and the `EMAIL_*` and `RAZORPAY_*`
   values from steps 2 and 2b.
4. Railway auto-detects `npm start`. Add a **volume** mounted at `/app/data` so the database
   persists across deploys (Settings → Volumes), and set `DB_PATH=/app/data/certbench.db`.
5. Deploy. On the very first start the server loads the built-in exams by itself (the log shows
   `[SETUP] Empty database: loading the built-in exams`). No seed command is needed.
6. Railway gives you a live `*.up.railway.app` URL immediately — that's your site. Add a
   custom domain under Settings → Domains if you own one.

### Render (equivalent alternative)
1. https://render.com → New → Web Service → connect your repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Add a **persistent disk** mounted at `/data`, set `DB_PATH=/data/certbench.db`.
4. Add the same environment variables as above.
5. Deploy. The built-in exams load automatically on the first start, as above.

Either way, in ~10 minutes you'll have a real HTTPS URL anyone can register, log in with an
emailed code, and take a graded mock exam on.

**Then give yourself the admin panel:** register on the live site, add `ADMIN_EMAILS` with your
email in the host's variables, and redeploy (section 2i, Option A). From then on you manage
certificates, questions and site text at `https://your-site/admin`.

## 4. Operational notes

- **Change `JWT_SECRET`** to your own random value before going live — don't reuse the one
  generated during local testing.
- **Back up `data/certbench.db` periodically** (or point `DB_PATH` at your host's persistent
  volume/disk, as above) — it holds every registered user and every exam attempt.
- **Rate limiting** is already on for `/api/auth/*` (30 requests / 15 min / IP) to blunt
  brute-force login and OTP-guessing attempts; adjust in `server.js` if needed.
- **Adding more exams**: use the admin panel (section 2i). Editing `src/seed.js` still works for the
  built-in list, but the admin panel is the normal way now.
- **Switching to Postgres** later (e.g. if you outgrow SQLite) mainly means swapping
  `src/db.js`'s `node:sqlite` calls for a Postgres client; the route files use plain SQL
  and would need only minor syntax changes (`?` placeholders → `$1`, etc).

## API summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register | – | Create an account |
| POST | /api/auth/login | – | Check password, send OTP, returns `pendingToken` |
| POST | /api/auth/verify-otp | – | Verify code, returns session `token` |
| POST | /api/auth/resend-otp | – | Send a new OTP for a pending login |
| POST | /api/auth/forgot-password | – | Email a password reset code (generic response either way) |
| POST | /api/auth/reset-password | – | Verify reset code and set a new password |
| GET  | /api/auth/me | ✓ | Fetch the signed-in user |
| GET  | /api/exams | (optional) | List exams with price; includes `enrolled` per exam if logged in |
| GET  | /api/exams/:slug/sets | ✓ | List the 5 practice sets for an exam, with your best score/attempts per set |
| POST | /api/exams/:slug/start | ✓ | Start a timed attempt for a chosen set (`{ setNumber: 1-5 }`); 402 if a paid exam isn't enrolled yet |
| POST | /api/exams/attempts/:id/submit | ✓ | Submit answers, graded server-side |
| GET  | /api/exams/attempts/mine | ✓ | Full attempt history across all exams/sets (the "My results" page) |
| GET  | /api/exams/attempts/:id | ✓ | Re-fetch a past result |
| GET  | /api/payments/config | – | Whether a live payment gateway is configured |
| POST | /api/payments/enroll | ✓ | Start enrollment for an exam (free exams enroll instantly) |
| POST | /api/payments/verify | ✓ | Verify a completed Razorpay payment |
| GET  | /api/payments/my-enrollments | ✓ | List the signed-in user's paid exam slugs |
