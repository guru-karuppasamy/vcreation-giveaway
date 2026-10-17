# V CREATION Giveaway — Website + Backend

This project includes:
- Responsive customer website using HTML, CSS, JavaScript, Bootstrap 5.
- Node.js + Express backend.
- SQLite database for users, submissions, entries, and admin audit records.
- Real SMS OTP verification using Twilio Verify.
- Private-by-route proof files (served only through authenticated admin endpoint).
- Manual admin review page at `/admin.html`.
- Eligible participant CSV export.
- Instagram URL preconfigured from the supplied profile link.

## Requirements
- Node.js 20 or newer.
- A Twilio account with a Verify Service.
- A public HTTPS host before real customers use the app.

## 1. Install
Open a terminal in this folder:

```bash
npm install
```

## 2. Configure secrets
Copy `.env.example` to `.env`.

Set:
- `JWT_SECRET`: long random secret (at least 32 characters).
- `ADMIN_USERNAME` and `ADMIN_PASSWORD`: your own strong admin credentials.
- `TWILIO_ACCOUNT_SID`.
- `TWILIO_AUTH_TOKEN`.
- `TWILIO_VERIFY_SERVICE_SID`.
- `WHATSAPP_GROUP_URL`: your actual group invite URL.
- `INSTAGRAM_PROFILE_URL`: your official profile.
- `CORS_ORIGIN`: your website origin.

Never share `.env` or commit it to Git.

## 3. Configure real SMS OTP (Twilio Verify)
1. Create/sign into a Twilio account.
2. Open Twilio Console and create a **Verify Service**.
3. Copy the Account SID and Auth Token from the console.
4. Copy the Verify Service SID (starts with `VA`) from Verify.
5. Put these three values in `.env`.
6. Restart the server.

This backend calls Twilio Verify to send a real SMS OTP and then checks the code through Twilio. It does not generate an OTP in browser code or return OTP values in API responses. Twilio account, destination-country permissions, billing, and applicable messaging rules must be configured. Trial accounts may restrict recipients to verified phone numbers.

## 4. Run
```bash
npm start
```
Open:
- Customer website: http://localhost:3000
- Admin review: http://localhost:3000/admin.html
- Health/config: http://localhost:3000/api/health

## 5. Test OTP
1. Enter your real mobile number on the website.
2. Press Send OTP.
3. Read the SMS delivered by Twilio.
4. Enter the OTP and press Verify & Continue.
5. Incorrect or expired codes are rejected.

If the API says OTP is not configured, check `.env` and restart the server.

## 6. Admin review
Open `/admin.html`, sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`.
Review uploaded WhatsApp, Instagram, and purchase evidence. Approve or reject submissions. A customer becomes eligible after all three latest task submissions are approved. Export eligible participants as CSV.

## Important production notes
This is a starter backend, not a complete production security audit. Before public launch:
- Deploy behind HTTPS.
- Use a managed database and private object storage for production-scale hosting.
- Set strict `CORS_ORIGIN`.
- Configure reverse-proxy trust correctly before relying on IP rate limits.
- Add campaign terms, consent, data retention, deletion workflows, monitoring and backups.
- Validate uploaded file contents, not only MIME headers; consider malware scanning.
- Keep uploads outside the public static directory (they are stored in `uploads/`, not `public/`).
- Implement a formal review/resubmission policy and ensure purchase bill checks against real store records.
- This app does not automatically select a winner; winner selection remains manual outside the website.

The OTP is real only when valid Twilio Verify credentials are configured. Never use the frontend-generated demo OTP approach for production.
