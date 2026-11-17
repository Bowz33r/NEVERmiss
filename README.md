# NeverMiss MVP

A small deadline-reminder web app with annual subscriptions paid in Bitcoin and manually verified by an administrator.

## Important Bitcoin payment behavior

The app displays the configured BTC address and lets a signed-in customer submit a Bitcoin transaction ID (TXID). It **does not automatically verify blockchain payments**. An administrator must independently verify the transaction on a trusted Bitcoin block explorer, check that it is confirmed, paid to the correct address, and meets the USD $50 value at the agreed exchange-rate/time, then approve it. Never activate an account based only on a customer-submitted TXID.

Bitcoin does not provide automatic recurring card-style billing. Customers must make a new payment each year. This MVP uses manual annual renewals.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set unique, long random values for `SESSION_SECRET` and `ADMIN_KEY`.
4. Run `npm install`.
5. Run `npm start`.
6. Open http://localhost:3000

The SQLite database is created as `nevermiss.sqlite`.

## Admin review

Use the `ADMIN_KEY` from `.env` as the `x-admin-key` header.

List submissions:

```bash
curl http://localhost:3000/api/admin/payments \
  -H "x-admin-key: YOUR_ADMIN_KEY"
```

Approve a verified payment:

```bash
curl -X POST http://localhost:3000/api/admin/payments/1/approve \
  -H "x-admin-key: YOUR_ADMIN_KEY"
```

Reject a payment:

```bash
curl -X POST http://localhost:3000/api/admin/payments/1/reject \
  -H "x-admin-key: YOUR_ADMIN_KEY"
```

Approval activates or extends membership by one year.

## Email reminders

The app supports SMTP email reminders. Fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` in `.env`. Without SMTP credentials, the dashboard works but emails are not sent. Configure a proper job scheduler and monitoring before production.

## Before taking real customers

This is a starter MVP, not a fully audited production service. Before launch:
- Use HTTPS and a secure production session store (not Express's default in-memory store).
- Use a strong secret and protect/rotate the admin key.
- Add CSRF protection, account recovery, email verification, backups and monitoring.
- Configure a reputable SMTP provider and test delivery.
- Independently verify every Bitcoin payment, including confirmations, destination address, amount and duplicate TXIDs.
- Publish privacy, refund, terms and subscription-renewal policies.
- Check local tax, consumer-protection, privacy and crypto-related requirements.
- Do not promise reminders until email delivery is configured and tested.

## Environment

See `.env.example`. The supplied Bitcoin address is prefilled as requested.


## Admin web page

After starting the app, open `http://localhost:3000/admin.html`, enter the `ADMIN_KEY` from `.env`, and review pending Bitcoin payment submissions. Only approve after independently checking the TXID, BTC mainnet destination address, confirmations and payment amount. The admin key is a powerful secret; use HTTPS, restrict access, and rotate it if exposed.
