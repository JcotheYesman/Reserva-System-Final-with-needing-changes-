# Reserva

## PHP and MySQL setup

1. Install PHP 8.1+ with `pdo_mysql`, MySQL, and Node.js.
2. Import `C:\Users\Justin\Desktop\reserva_db_complete_2.sql` into MySQL. The dump creates the `reserva_db` database.
3. Run `database/backend_extensions.sql` against `reserva_db` to add the application state table used by profile preferences, settings, and supplemental records.
4. Run `database/payment_checkout_migration.sql` once against `reserva_db`. It adds saved e-wallet methods, payment types and idempotency, booking completion timestamps, and the financial ledger without deleting existing reservation or payment records.
5. Run `database/equipment_rental_migration.sql` once against `reserva_db`. It adds the equipment catalog and reservation snapshots without changing existing bookings.
6. Set `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, and `DB_PASSWORD` in the PHP server environment. Defaults are `127.0.0.1`, `3306`, `reserva_db`, `root`, and an empty password. Do not put database credentials in frontend code.
7. Copy `.env.example` to `.env` and set `PAYMENT_DATA_KEY` to a unique random secret of at least 32 characters. Keep this key private and stable; changing it prevents previously saved e-wallet numbers from being decrypted. The app encrypts saved GCash/Maya mobile numbers and never stores wallet passwords, PINs, or OTPs.
8. From the repository root, run `npm run dev`. This starts the PHP API and Vite together. PHP must be available on `PATH`; on Windows, set `PHP_PATH` to your `php.exe` if it is not in `PATH` (for example, `C:\xampp\php\php.exe`). MySQL must also be running.

Vite proxies `/api` to the PHP server. Use `npm run dev:ui` only when you intentionally want to run the frontend without the PHP API. For deployment, serve the frontend and `api/` from the same origin or set `VITE_API_URL` to the deployed PHP API URL.

The PHP entry point is `api/index.php`; it uses PDO prepared statements and PHP session cookies. Authentication, facility catalog/management, profile updates, availability, and seeded reservation reads use the imported tables. `app_state` stores reservation workflow snapshots and supporting owner, payout, notification, review, and admin records that the supplied schema does not model.

Google sign-in uses a server-side authorization-code flow. Copy `.env.example` to `.env`, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register the exact callback URL shown in `RESERVA_OAUTH_CALLBACK_URL` in Google Cloud Console. Set `RESERVA_FRONTEND_URL` and `RESERVA_OAUTH_CALLBACK_URL` to the public site URLs for deployment. `npm run dev` loads `.env` for both the PHP API and Vite. Social sign-in creates a regular user account on first use and links later sign-ins to that account by the provider's verified identity.

Password recovery needs an email sender, and payment capture/account verification need payment-provider integrations. Those operations return an explicit configuration error until providers are configured.

GCash and Maya bookings currently use manual transfer receipts. A booking payment remains pending until an administrator verifies the proof. Card payment is disabled until a secure gateway is configured; the app does not simulate card charges or payment success.
