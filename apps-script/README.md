# 10-Second Reply: Apps Script master

One Google Sheet + one Apps Script project serves your own sales pipeline and all clients.

## Deploy (about 10 minutes)
1. Create a Google Sheet "10-Second Reply master" in michalbenko3@gmail.com. Extensions → Apps Script → paste `Code.gs`.
2. Run `setup()` once (authorise). It creates tabs Leads, Clients, Events, creates the hourly trigger and prints SECRET in the log (also in Project settings → Script properties).
3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone. Copy the `/exec` URL.
4. In Vercel add env vars:
   - `REPLY_DEMO_HOOK` = `<exec URL>?key=<SECRET>`  (demo tries and interest forms land in the Leads tab)
   - `APPS_SCRIPT_URL` = `<exec URL>` and `APPS_SCRIPT_SECRET` = `<SECRET>`  (used by `/api/stripe-webhook`)
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_...` of the endpoint below
   Note: `APPS_SCRIPT_URL` and `APPS_SCRIPT_KEY` already exist for the Slovak audit tool. Use a separate deployment URL for this project, do not overwrite them.
5. Stripe Dashboard → Developers → Webhooks → endpoint `https://michalbenko.sk/api/stripe-webhook`, event `checkout.session.completed`.

## Stripe Payment Link
- Product: 10-Second Reply, €49 monthly, EUR.
- Collect business name; require terms acceptance (set the terms URL to `https://michalbenko.sk/en/privacy/` in Dashboard → Settings → Public details).
- Custom fields (keys exactly): `website` (text), `formplatform` (dropdown: WordPress, Wix, Squarespace, Webflow, Typeform/other), `alertemail` (text).
- After payment: redirect to a thank-you message, no onboarding form needed (E2 asks two questions by e-mail).
- The 3-month minimum cannot be enforced in a Payment Link. State it in the product description and the terms.

## How it behaves
- Demo/interest rows → Leads. E1 goes out once, 24–72 h after a demo, only while Status is New (an interest form cancels it).
- Payment → row Paid, E2 to the buyer, a new Google Sheet "Leads — {business}" shared with the alert e-mail, a Clients row (Active = FALSE), and a notification to you with the client's webhook URL.
- To go live: connect the client's form to `<exec URL>?client=<slug>&token=<token>` (POST JSON `name, email, phone, message`), set Active = TRUE, test, then set the Leads status to Live (sends E3 and activates the client).
- Follow-up: hourly job, any client lead still Status New 24–72 h after creation gets one follow-up. Clients change the Status dropdown to Contacted to stop it.
- Mail goes from your Gmail with the client's name as display name and the client's address as Reply-To. Quota 100 recipients/day on consumer Gmail; the job warns you when it runs low.

## Not verified
- Behaviour with real Stripe payloads and with each form platform's webhook. Test with Stripe test mode and one real client form first.
