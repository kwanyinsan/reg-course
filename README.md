# Course Registration

A full-stack course registration project I built with React, Express, and PostgreSQL. Participants can browse courses, submit one application for several courses, and receive an acknowledgement by email. Administrators can manage registration questions, take session attendance, and send attendance results and certificates.

The project also includes combined payments, English PDF certificate templates, and a read-only administrator activity viewer. Payment is simulated: clicking Pay records a successful payment in the database without contacting a bank or charging money.

## Features

- Browse published courses, view session details, and filter by search, course mode, and registration availability.
- Select 1–10 courses, review individual fees and the combined total, and complete shared personal details once.
- Keep course-specific text, single-choice, and multiple-choice questions separate for each selected course.
- Save the application, registrations, payment, activity records, and browser retry information transactionally.
- Send one combined English acknowledgement after saving the application. Email failure does not undo registration.
- Open a protected payment link from the acknowledgement or email, including in another browser, and pay explicitly.
- Provide separate administrator login, course workspaces, and registration lists grouped by whole submission.
- Edit draft question definitions and English certificate wording, with publication locks and stale-edit checks.
- Preview and download A4 landscape certificate PDFs using the same renderer used for issued certificates.
- Email personal attendance-scanner links and display a session QR code for the teacher to show.
- Record attendance with one successful scan, allow reasoned administrator corrections, and calculate equal-session attendance percentages.
- Send each participant their own session attendance result after the session ends.
- Issue and email certificates to attendance-qualified participants, preserving the wording and exact issued PDF.
- View recorded actions with safe descriptions, related-record links, filters, and newest-first pagination.
- Use English, Traditional Chinese, or Simplified Chinese on the website. Emails and certificate wording remain English-only; displayed dates and times use Asia/Hong_Kong.

## Tech stack

| Layer | Technology | Location |
| --- | --- | --- |
| Frontend | React, Vite, JavaScript, and plain CSS | `frontend/` |
| Backend | Express CommonJS and node-postgres (`pg`) | `backend/src/` |
| Database | PostgreSQL with JSONB validators and history guards | `database/schema.sql` |
| Authentication | bcryptjs, express-session, and connect-pg-simple | `backend/src/server.js`, `session.js`, and `auth.js` |
| Email | Nodemailer with database templates and logged send outcomes | `backend/src/mail.js` and the acknowledgement/attendance/certificate mail modules |
| Certificates | PDFKit, fontkit, an embedded Noto font, and PDF.js | `backend/src/certificate-pdf.js`, `backend/assets/fonts/`, and `frontend/src/components/CertificatePdfPreview.jsx` |
| Attendance QR | qrcode and qr-scanner | `backend/src/admin-attendance.js` and `frontend/src/components/AttendanceScanner.jsx` |
| Linux hosting | PM2 and Nginx | PM2 runs Express; Nginx serves the frontend build and proxies API requests |

The browser sends root-relative `/api/...` requests. Express validates the request, checks administrator or protected-link access, queries PostgreSQL, and returns JSON or a PDF.

- **Local development:** Vite serves React at `http://127.0.0.1:5173` and forwards `/api/...` to Express at `http://127.0.0.1:3000`, removing `/api`.
- **Linux hosting:** Nginx serves `frontend/dist` and forwards `/api/...` to the loopback Express port. The Vite development server is not used for hosting.

Navigation uses URL hashes such as `/#courses` and `/#admin/courses`. Personal payment and attendance links also use root-level hash routes, so the website should be hosted at the origin root rather than under a subdirectory.

## Run locally on Windows

These commands use PowerShell. Install Git, Node.js with npm, and PostgreSQL first. Use Node.js 22.13 or newer on the 22.x line, or a compatible newer LTS release. The PDF.js dependency requires at least Node.js 22.13. PostgreSQL 18 was used for this project.

### 1. Clone the project

```powershell
git clone https://github.com/kwanyinsan/reg-course.git
cd reg-course
```

The following setup commands start from the repository root. If PostgreSQL commands are not on your PATH, add its `bin` folder for this PowerShell session. Adjust `18` to match your installation:

```powershell
$env:Path = "C:\Program Files\PostgreSQL\18\bin;$env:Path"
```

### 2. Create the database

For a new environment, connect as the PostgreSQL administrator:

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -W
```

At the `psql` prompt, run the following one command at a time:

```sql
CREATE ROLE reg_course_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password reg_course_app
CREATE DATABASE reg_course OWNER reg_course_app;
\q
```

`\password reg_course_app` prompts for the new password twice. Enter it at the prompts, not as an extra argument. Keep it for `backend/.env`.

Back in PowerShell, create the schema as its owner:

```powershell
psql -h 127.0.0.1 -p 5432 -U reg_course_app -d reg_course -W -v ON_ERROR_STOP=1 -1 -f database/schema.sql
```

`ON_ERROR_STOP=1` stops on an SQL error, and `-1` runs the schema in one transaction. Run this once for a new database. Do not apply it over an existing populated database or a restored dump.

The exact names `reg_course` and `reg_course_app` are required by `backend/src/db.js`. The application must not use the PostgreSQL superuser or another project's database role.

The schema creates nine application tables: `admin`, `course`, `question`, `certificate`, `email`, `submission`, `registration`, `payment`, and `log`. The additional `session` table is created when needed by connect-pg-simple and is not seeded.

### 3. Install dependencies and configure the backend

```powershell
cd backend
npm.cmd ci
notepad .env
```

Create `backend/.env` if it does not exist. If it already exists, preserve its private settings. There is no `.env.example` file. Use this structure and replace the placeholders with your own values:

```dotenv
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://127.0.0.1:5173

PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=reg_course
PGUSER=reg_course_app
PGPASSWORD="replace_with_your_database_password"

SESSION_SECRET="replace_with_a_generated_session_secret"
SESSION_MAX_AGE_MS=28800000
PAYMENT_LINK_SECRET="replace_with_a_generated_payment_secret"
ATTENDANCE_LINK_SECRET="replace_with_a_different_attendance_secret"

SEED_STAFF_USERNAME="admin"
SEED_STAFF_PASSWORD="replace_with_your_admin_password"

SMTP_HOST=smtp.example.invalid
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_AUTH=password
SMTP_USER="replace_with_your_smtp_username"
SMTP_PASSWORD="replace_with_your_smtp_password"
SMTP_FROM_ADDRESS=sender@example.invalid
SMTP_FROM_NAME="Course registration"
```

The SMTP host, port, security, authentication, and sender must match your provider. The sample values are placeholders, not a working mail service or an approved sender identity.

- `SMTP_SECURITY` accepts `tls` for implicit TLS or `starttls` for required STARTTLS. Plain unencrypted SMTP is not supported.
- `SMTP_AUTH` accepts `password` or `none`. Password authentication requires `SMTP_USER` and `SMTP_PASSWORD`.
- `SMTP_FROM_NAME` is optional. Use only a sender address/name your provider permits.
- SMTP uses certificate verification and bounded connection/send timeouts. A missing or invalid mail configuration can cause an email attempt to fail without undoing a saved application.

Generate the session secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Generate each link secret separately, copying each result into its own setting:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Run that command twice. Payment and attendance each require a separate 32-byte base64url secret, represented by 43 characters. The session secret must contain at least 32 UTF-8 bytes.

Keep these values private and stable across normal restarts. Changing the session secret invalidates existing administrator cookies. Changing a link secret invalidates the corresponding previously issued links.

`APP_ORIGIN` must be the exact browser origin, with its protocol and port but no path or trailing slash. Use `127.0.0.1` consistently rather than switching between it and `localhost`. The backend checks the request origin and uses this value when generating email links.

The seed variable names still contain `STAFF` for configuration compatibility; the account and interface are called Admin. The administrator password must contain at least 8 characters and fit within 72 UTF-8 bytes.

`.env` is ignored by Git. Do not put credentials, signing secrets, database dumps, or participant data in frontend code or `VITE_` variables.

### 4. Seed the starter data

From `backend/`, run:

```powershell
npm.cmd run seed
```

On a fresh database, the summary should report:

```text
Administrator accounts inserted: 1
Email templates inserted: 4
Courses inserted/skipped: 10 0
Applications inserted/skipped: 6 0
```

This also inserts each course's question bank and certificate template, nine course registrations across the six applications, payment records, sample attendance where declared, and application seed logs. All nine application tables receive starter data. It does not send emails, issue certificates, or create login/application sessions.

Starter data is declared at the top of `backend/src/seed.js`, above `END OF EDITABLE DATA`. Edit that section to change the initial courses, sessions, questions, certificate wording, four shared email templates, and sample applications. No `--demo` flag or separate seed scripts are used.

The included dates are fixed Hong Kong dates in 2026. Registration availability, payment expiry, attendance windows, and certificate eligibility depend on those dates and current server time. Sample participant addresses use `example.invalid`; use your own authorised recipient for mail checks.

Seeding is transactional and skips existing records by their identifying keys. It does not reset an existing administrator's password or overwrite edited courses/templates. Editing seed data and rerunning it is not an update mechanism for an existing database, and does not bypass publication or issued-history guards.

### 5. Start both servers

In one terminal, from `reg-course/backend`:

```powershell
npm.cmd run dev
```

The backend uses Node's watch mode. `npm.cmd start` runs the same server without watching for changes.

In a second terminal:

```powershell
cd D:\Projects\reg-course\frontend
npm.cmd ci
npm.cmd run dev
```

Adjust the checkout path if necessary. Open **http://127.0.0.1:5173/**. Vite uses a fixed port and reports an error if port 5173 is occupied, rather than silently changing the origin.

Administrator access is at **http://127.0.0.1:5173/#admin/courses**. Use the credentials configured before seeding. There is no public participant account or administrator sign-up page.

### 6. Verify the local app

In another PowerShell terminal:

```powershell
curl.exe -i http://127.0.0.1:3000/status
curl.exe -i http://127.0.0.1:5173/api/courses
```

Expect HTTP `200` and status JSON from `/status`, and course JSON through `/api/courses`. The status endpoint checks Express connectivity only; it does not query PostgreSQL or verify SMTP. The course request checks database-backed browsing through the proxy.

In the browser:

1. Browse courses, select more than one available course, and verify the combined total.
2. Log in to Admin, refresh to check session restoration, and log out.
3. With an authorised email recipient, submit an application and verify its saved submission and course registrations in Admin.
4. Check the combined acknowledgement email. A positive-total application should have one payment link; a zero-total application should have no payment record or button.
5. Open the payment link in another browser context. Viewing it must not pay; clicking Pay records the simulated result.
6. Use a draft course for question/certificate editing. Use courses with suitable session dates and attendance records for attendance and certificate checks.

These actions create records and may send real emails through the configured SMTP service. Use controlled data and recipients. The full attendance and certificate workflows depend on their timing and eligibility rules below; an expired starter session cannot be reopened simply by refreshing its page.

The frontend's available checks, from `frontend/`, are:

```powershell
npm.cmd run lint
npm.cmd run build
```

The backend package commands are only `dev`, `start`, and `seed`. Maintenance scripts and automated-test folders are not included in the current repository.

## Application, payment, and email behaviour

The public flow is **Courses → Selected courses → Application form → Review → Acknowledgement**. Shared participant details are saved in one `submission`; each selected course receives a separate `registration` with its own answers and saved fee.

The server recalculates fees and rechecks course availability and question definitions before saving. Application retry protection belongs to the current browser application session. Repeating the same request in that session returns its existing result; it is not a permanent participant identity or a cross-browser duplicate-registration rule.

The acknowledgement is shown once after submission. Leaving or refreshing it makes it unavailable; the application cookie alone cannot reopen it. An active form can recover an uncertain submission response using its in-memory review token. This is separate from the internal eight-hour application session lifetime. Unsaved form details are not a durable saved draft.

For a positive-total application, one pending payment is created in the application transaction. Its amount comes from saved fees, and its deadline is the earliest selected-course payment deadline. Zero-total applications create no payment. Existing historical applications without a payment are not silently backfilled.

The acknowledgement and email use protected access to the same combined payment. A payment link works without the original application cookie, expires at its saved deadline, and grants access only to that payment. GET requests do not pay. The Pay action validates server time, amount, cancellation, and payment history transactionally; repeated payment requests recover the existing result. The link itself can expire even after payment, while the paid record remains in Admin.

Email sending starts after the related database transaction has committed and its client has been released. Acknowledgements, scanner emails, attendance-result emails, and certificate emails use separate templates/events. Templates live in `email`; the seed does not overwrite existing installed wording.

Requested, started, accepted, failed, and uncertain outcomes are recorded in `log`. SMTP acceptance means the server accepted the message, not that it reached the inbox. Accepted messages are not automatically resent. Definite failures can be retried where an administrator action is provided; a started attempt with no confirmed outcome remains uncertain. A crash between SMTP acceptance and recording the outcome cannot provide exactly-once delivery.

## Attendance and certificates

For a published course session, the administrator opens **Attendance taking** and sends personal scanner emails. **Show QR code** opens the teacher's full-screen session QR. Each participant opens their own emailed link, then scans the displayed QR using their camera or an uploaded QR image. Fetching the link alone does not record attendance.

- Attendance can be opened from 15 minutes before the session starts until its end. One attendance round lasts up to 30 minutes, capped at the session end; the current implementation does not reopen an existing round.
- The displayed QR refreshes and each code expires within 90 seconds. The personal scanner link is bound to its registration, course, session, and round.
- One successful scan stores server-recorded `recorded_at` and `attended=true`. There is no checkout.
- Repeated scans preserve the original record. Corrections require an administrator, a reason, and a valid time from 15 minutes before the session start through its end, no later than now.
- Attendance percentage is the number of attended sessions divided by all course sessions, with equal weighting. It remains provisional while sessions are unfinished.
- Cancelled registrations/submissions are excluded. Payment status is displayed but is not an attendance or certificate eligibility condition.

A shared classroom QR identifies a session, not an unknown participant. Identity comes from the protected personal link. It can be opened on a new device, but a forwarded link can also be used by its holder; neither link possession nor scanning proves physical presence.

**Send attendance results** becomes available after the session ends. It emails each active participant only their own recorded or missing attendance result, including participants with no record. A correction sends nothing automatically. A changed result requires explicit confirmation before another notification; accepted and uncertain attempts are protected from ordinary repeat sends. Scanner-mail and result-mail progress are separate.

Certificate wording uses one template per course with English `heading`, `body`, and `footer`. The supported placeholders are:

```text
{{participant_name}}
{{course_title}}
{{course_code}}
{{certificate_number}}
{{issued_date}}
```

Save the template before first publication. Previously published courses remain locked even if their current state changes. A published course missing a template cannot be repaired by bypassing the lock or rerunning the seed.

The PDF layout is fixed A4 landscape. Preview values are clearly marked as not issued; previews do not populate registration certificate fields. Unsupported characters and overflowing content are rejected instead of silently clipped. The embedded font and its OFL licence are retained in `backend/assets/fonts/`.

**Send certificates** processes eligible registrations from the course workspace. All sessions must have ended, attendance must meet the course percentage, the registration/submission must be active, and a valid template and usable recipient must exist. Published and previously published archived courses can qualify. Payment is not required.

Issuance saves one unique number, the issue time, participant/course/template snapshots, and the exact PDF bytes with integrity metadata in `registration.certificate_data`. The email thanks the participant and attaches that PDF. Email retries and administrator downloads reuse the saved document rather than changing its number, date, or wording. Issued certificate history and attendance are protected from later modification.

## Deploy to a Linux server with PM2 and Nginx

The following reproduces the project's IP-based **HTTP** hosting arrangement in `/opt/reg-course`. Use the existing server account and inspect installed software, PM2 processes, occupied ports, databases, and enabled Nginx sites first. Do not upgrade shared software, overwrite another application, or run PM2 actions against all processes.

### 1. Prepare the checkout and database

From Windows PowerShell, connect with your own server details:

```powershell
ssh YOUR_SSH_USER@YOUR_SERVER_IP
```

For a new checkout on Linux:

```bash
cd /opt
sudo git clone https://github.com/kwanyinsan/reg-course.git reg-course
sudo chown -R "$(id -un):$(id -gn)" /opt/reg-course

cd /opt/reg-course/backend
npm ci --omit=dev

cd ../frontend
npm ci --include=dev
npm run build
```

If the directory exists, inspect its Git state instead of cloning over it. Node must meet the frontend build requirements. Build dependencies are needed for `npm run build`, even when the backend will run without development dependencies.

For a new database, enter PostgreSQL as its administrator:

```bash
sudo -u postgres psql -X -P pager=off -d postgres
```

Create `reg_course_app`, set its password using `\password`, and create `reg_course` as in the Windows setup. Then, from the Linux shell:

```bash
psql -X -P pager=off -h 127.0.0.1 -p 5432 \
    -U reg_course_app -d reg_course -W \
    -v ON_ERROR_STOP=1 -1 \
    -f /opt/reg-course/database/schema.sql
```

This path is for a fresh database. If migrating an existing database, restore it with the correct ownership instead of applying the schema and seed. Preserve payment history, certificate PDF data, logs, and link secrets. Keep dumps outside Git and public web directories.

### 2. Configure the backend and seed a fresh database

```bash
cd /opt/reg-course/backend
touch .env
chmod 600 .env
nano .env
```

Use the settings from the local setup with the server's database password and private SMTP values. For this HTTP arrangement, use:

```dotenv
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://YOUR_SERVER_IP
```

Replace `YOUR_SERVER_IP` with the actual address used in the browser. `NODE_ENV=development` here permits HTTP cookies and an HTTP origin; it does not mean running Vite or Node's watch mode on the server. The frontend is still the compiled static build, and PM2 runs `src/server.js` normally.

Only for the fresh database:

```bash
npm run seed
```

Do not paste `.env` contents into GitHub issues or logs. Reuse this application's signing keys when retaining its issued links; do not reuse another application's secrets. New emails use the configured `APP_ORIGIN`. Emails already sent with localhost links do not change when the application is deployed.

### 3. Start the backend with PM2

Confirm port 3000 is available and inspect the existing process list. If replacing another application, stop only its confirmed process at the agreed cutover. Do not create a duplicate backend on the same port.

For a new reg-course process:

```bash
cd /opt/reg-course/backend
pm2 start src/server.js --name reg-course --cwd /opt/reg-course/backend --time
pm2 status
```

Check the backend before routing public traffic to it:

```bash
curl -i http://127.0.0.1:3000/status
curl -i http://127.0.0.1:3000/courses
```

Both should return HTTP `200`; the second request queries PostgreSQL. For later maintenance:

```bash
pm2 logs reg-course --lines 30 --nostream
pm2 restart reg-course --update-env
```

Run PM2 as the same operating-system user consistently. Inherited process-environment values take precedence over `.env`, so update those too if the process was started with inline overrides. After confirming the intended process list, run `pm2 save`. Inspect the existing startup service; configure `pm2 startup` only if it is not already configured, following the exact command PM2 prints. Reboot recovery needs its own verification at an agreed time.

### 4. Serve the frontend and API through Nginx

Edit the actual enabled site for this hostname/IP. It may be `/etc/nginx/sites-available/default` on an existing server; do not add a conflicting site or replace the global Nginx configuration.

Use this server block with your address:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name YOUR_SERVER_IP;
    root /opt/reg-course/frontend/dist;
    index index.html;
    client_max_body_size 256k;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ \.mjs$ {
        types { text/javascript mjs; }
        try_files $uri =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 120s;
    }
}
```

The trailing slash in `proxy_pass` removes `/api/`, matching the Vite proxy. `/api/login` reaches Express as `/login`. Keep the browser's original `Origin` header; do not replace every incoming origin with the allowed value.

The `.mjs` location supplies the JavaScript MIME type for the PDF.js worker. Retain all generated assets, including PDF and QR scanner workers. The 256 KiB body allowance matches the largest Express JSON limit; proxy timeouts allow for requests awaiting SMTP responses.

Only `frontend/dist` is public. Keep `backend/.env`, database dumps, and private files outside that root. Check directory traversal/read permissions if Nginx reports permission errors; do not make the entire repository broadly writable or expose private configuration.

Validate before applying:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Verify the hosted website

```bash
curl -i -H 'Host: YOUR_SERVER_IP' http://127.0.0.1/
curl -i -H 'Host: YOUR_SERVER_IP' http://127.0.0.1/api/status
curl -i -H 'Host: YOUR_SERVER_IP' http://127.0.0.1/api/courses
```

Expect the Course registration HTML, Express status JSON, and database-backed course JSON. A status response alone does not verify the rest of the application.

From another computer, open `http://YOUR_SERVER_IP/`, log in at `/#admin/courses`, refresh, and log out. Confirm the site remains reachable after closing SSH. Use authorised records and recipients for application, payment, attendance, email, and PDF checks; successful hosting does not prove all those workflows or cross-browser/accessibility checks passed.

### HTTP and production limitations

HTTP does not encrypt administrator credentials, session cookies, participant information, or protected access tokens. Use non-sensitive data and passwords not reused elsewhere for this arrangement. Remote phone-camera access generally requires a trusted HTTPS origin; local loopback camera behaviour is not evidence that an HTTP public-IP camera scanner will work. QR-image upload is available separately.

Setting `NODE_ENV=production` requires an HTTPS `APP_ORIGIN` and enables secure administrator/application cookies. The current `server.js` does not configure Express `trust proxy`. Before using HTTPS terminated at Nginx, configure and verify the exact trusted proxy boundary so Express recognises secure requests and the correct client IP. Forwarding headers alone does not make Express trust them. With the current untrusted proxy, IP-based rate limits can group all proxied users together.

This README describes the current HTTP setup; it does not configure TLS or claim the unchanged application is ready for production behind an HTTPS reverse proxy.

## Project structure

| File or folder | Purpose |
| --- | --- |
| `database/schema.sql` | Tables, JSON validators, publication rules, attendance validation, and paid/issued-history guards. Run once for a new database. |
| `backend/src/seed.js` | All editable starter data at the top; transactional insertion helpers below it. |
| `backend/src/server.js` | Express entry point, route mounting, login/current/logout, body limits, and error handling. |
| `backend/src/db.js`, `session.js`, `auth.js`, `security.js` | Database pool, PostgreSQL-backed administrator sessions, authorisation, origin/header checks, and login rate limits. |
| `backend/src/courses.js`, `admin.js` | Public course reads, administrator course/registration views, submission grouping, and publish/archive actions. |
| `backend/src/questions.js` | Administrator question-bank read/save operations and conflict checks. |
| `backend/src/application.js`, `application-validation.js` | Course review definitions, validation, application transactions, retry protection, and active-form result recovery. |
| `backend/src/payment.js`, `payment-access.js` | Combined payment creation, signed payment links, state reads, and explicit payment completion. |
| `backend/src/mail.js`, `acknowledgement.js` | SMTP configuration, safe outcome classification, and combined application acknowledgement rendering/sending. |
| `backend/src/attendance.js`, `attendance-access.js`, `admin-attendance.js` | Attendance rounds, signed scanner/QR access, single-scan recording, percentages, and corrections. |
| `backend/src/attendance-mail.js`, `attendance-result-mail.js` | Separate personal-scanner and individual-result emails, snapshots, and retry guards. |
| `backend/src/certificates.js`, `certificate-template.js`, `certificate-pdf.js` | Certificate wording endpoints, validation, placeholder resolution, and shared PDF layout. |
| `backend/src/certificate-issuance.js`, `issued-certificate.js`, `certificate-mail.js` | Eligibility, immutable issuance/PDF storage, administrator downloads, and certificate attachments. |
| `backend/src/log.js`, `activity.js` | Action insertion and the safe, read-only administrator activity projection. |
| `backend/assets/fonts/` | Embedded Noto font and its OFL licence, required at PDF-rendering time. |
| `frontend/src/main.jsx`, `App.jsx` | React entry point, hash routing, language/selection state, administrator session state, and shared notifications. |
| `frontend/src/components/SiteLayout.jsx`, `Notification.jsx` | Shared layout and notification presentation; payment/scanner views use their standalone layout. |
| `frontend/src/components/CourseList.jsx`, `CourseDetails.jsx`, `SelectedCourses.jsx`, `Registration.jsx` | Public browsing, selection, personal/course questions, review, and acknowledgement. |
| `frontend/src/components/AdminArea.jsx`, `AdminCourseList.jsx`, `AdminCourseDetails.jsx`, `AdminRegistrationList.jsx`, `AdminRegistrationDetails.jsx` | Administrator navigation, course workspaces, grouped registrations, and registration details. |
| `frontend/src/components/CourseQuestionEditor.jsx`, `QuestionFields.jsx` | Question editing, preview, and participant question rendering. |
| `frontend/src/components/CourseCertificateEditor.jsx`, `CertificatePdfPreview.jsx` | English template editing and rendering the generated PDF through PDF.js. |
| `frontend/src/components/Payment.jsx`, `AttendanceScanner.jsx`, `AttendanceQr.jsx` | Protected participant payment/scanner screens and the administrator QR display. |
| `frontend/src/components/SessionAttendance.jsx`, `AttendanceCorrection.jsx`, `SessionAttendanceResults.jsx` | Session attendance records, corrections, and result-email controls. |
| `frontend/src/components/CourseCertificateSend.jsx`, `IssuedCertificate.jsx`, `AdminActivity.jsx` | Certificate batch progress, issued-document details, and activity browsing. |
| `frontend/src/*-api.js`, `payment-link.js`, `*-utils.js`, `use-notification.js` | Request helpers, protected-link capture, formatting, editor state helpers, and notifications. |
| `frontend/src/translations/` | One website translation file per supported language. |
| `frontend/vite.config.js` | Fixed local frontend port and `/api` development proxy. |

Browser local storage retains language and selected course IDs. Protected payment/scanner tokens are captured from the emailed hash link into tab/session state and removed from the visible hash. Personal application details and the show-once acknowledgement are held in React state rather than treated as a permanent participant account.

## API

These are direct Express paths. Through Vite or Nginx, prepend `/api`.

| Method | Route | Access and purpose |
| --- | --- | --- |
| GET | `/status` | Express connectivity only. |
| GET | `/courses`, `/courses/:id` | Published course browsing/details. |
| POST | `/login` | Administrator username/password login. |
| GET | `/current` | Current administrator; returns `401` without a valid session. |
| POST | `/logout` | End the current administrator session. |
| POST | `/application/definition` | Establish/review selected course definitions in an application session. |
| POST | `/application` | Validate and save a combined application, then attempt acknowledgement email. |
| GET | `/application/result` | Active-form uncertain-response recovery; requires its cookie and `X-Application-Review` token. |
| POST | `/application/new` | Start a deliberate new application browser context. |
| GET | `/payment` | Read the payment authorised by its bearer token. |
| POST | `/payment/pay` | Explicitly record the authorised simulated payment. |
| GET | `/attendance` | Read the participant/session context authorised by its bearer token. |
| POST | `/attendance/record` | Record attendance with both personal access and a valid session QR token. |
| GET | `/admin/courses`, `/admin/courses/:id` | Administrator course lists/workspaces. |
| POST | `/admin/courses/:id/state` | Publish or archive with current-state checks. |
| GET | `/admin/registrations`, `/admin/registrations/:id` | Grouped submission listing and individual registration details. |
| GET, PUT | `/admin/courses/:id/questions` | Read/save course question definitions. |
| GET, PUT | `/admin/courses/:id/certificate` | Read/save English certificate wording. |
| POST | `/admin/courses/:id/certificate/preview` | Render an administrator-only PDF preview without issuance. |
| GET | `/admin/courses/:id/attendance/:sessionId` | Session roster, attendance, and scanner/result-mail states. |
| POST | `/admin/courses/:id/attendance/:sessionId/start` | Open the attendance round. |
| GET | `/admin/courses/:id/attendance/:sessionId/qr` | Generate the current session QR without recording attendance. |
| POST | `/admin/courses/:id/attendance/:sessionId/email` | Send/retry one participant's scanner email. |
| POST | `/admin/courses/:id/attendance/:sessionId/result-email` | Send one participant's approved result snapshot. |
| PUT | `/admin/registrations/:id/attendance/:sessionId` | Reasoned attendance correction or clearing. |
| GET | `/admin/courses/:id/certificates` | Eligibility, issued records, and certificate-email states. |
| POST | `/admin/courses/:id/certificates/send` | Issue/reuse and email one registration's certificate within the UI batch. |
| GET | `/admin/registrations/:id/certificate` | Issued metadata and email outcome. |
| GET | `/admin/registrations/:id/certificate/pdf` | Protected download of the saved issued PDF. |
| GET | `/admin/activity` | Safe activity projection with filters and cursor pagination. |

All `/admin` routes require the administrator session. State-changing requests also require the exact configured `Origin`, `X-Requested-With: reg-course`, and `Content-Type: application/json`. An empty action body should be `{}` where required. Payment and participant attendance requests use `Authorization: Bearer ...`; a readable reference or numeric ID alone does not grant access.

Course-scoped attendance/certificate batch controls send bounded per-participant requests from the browser. They are not scheduled jobs or background workers. Closing the page can interrupt a batch; stored outcomes determine which remaining or definitely failed messages can be resumed safely.

The activity viewer shows actions actually recorded by the application, not a comprehensive access audit. It exposes selected safe fields rather than full log JSON, email bodies, private tokens, or PDF data. It provides no log edit/delete/export controls.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `psql` is not recognised | Add the PostgreSQL `bin` directory to PATH for the terminal. Run shell commands at PowerShell/Bash, not inside `psql`. |
| PostgreSQL output shows `(END)` | Press `q`; use `psql -P pager=off` for subsequent commands. |
| Database password authentication fails | Confirm the dedicated role password matches `PGPASSWORD`, and that host/port identify the intended cluster. |
| Backend refuses to start | Check required database settings, the session secret, and an exact valid `APP_ORIGIN`. HTTP origins are rejected when `NODE_ENV=production`. |
| Login or a save returns `403` | Match the browser origin to `APP_ORIGIN`; retain the security header and JSON content type. |
| Login does not survive refresh | Check session database access, expiry, hostname consistency, and secure-cookie/proxy configuration. |
| Requests return `429` behind Nginx | Current Express proxy trust is unset, so proxied clients may share an IP-based rate limit. |
| Browser shows an older website/build | Compare the served HTML/assets with `frontend/dist`, then force reload with browser caching disabled. Confirm the active Nginx root. |
| Seed changes do not appear | Existing rows are preserved. The seed is initial data creation, not an editor or template updater. |
| Attendance taking is unavailable | Check publication state, the session's Hong Kong times, and whether its one round has already opened/expired. |
| Camera scanner does not open on a phone | Check permissions and reachable trusted HTTPS. A public HTTP IP does not behave like local loopback. Use QR-image upload where suitable. |
| Certificate cannot be sent | Read the eligibility reasons: unfinished sessions, insufficient attendance, cancellation, missing/locked template, unusable recipient, unsupported text, or overflow. |
| PDF preview is blank | Retain the embedded font, PDF.js worker asset, correct `.mjs` MIME type, and administrator session. |
| Registration saved but email did not arrive | Inspect the recorded mail outcome and provider settings. SMTP acceptance is not inbox confirmation; do not submit another application to retry email. |
| Payment/scanner link points to localhost | Correct `APP_ORIGIN` before new sends. Previously sent URLs do not update automatically. |

## References

- [React: state and rendering](https://react.dev/learn)
- [Vite: static deployment](https://vite.dev/guide/static-deploy.html)
- [Express: routing](https://expressjs.com/en/guide/routing.html)
- [Express: behind proxies](https://expressjs.com/en/guide/behind-proxies.html)
- [express-session configuration](https://expressjs.com/en/resources/middleware/session.html)
- [node-postgres: parameterised queries](https://node-postgres.com/features/queries)
- [Nodemailer: SMTP transport](https://nodemailer.com/smtp)
- [PDFKit](https://pdfkit.org/)
- [PDF.js](https://github.com/mozilla/pdf.js)
- [qr-scanner](https://github.com/nimiq/qr-scanner)
- [PM2: startup persistence](https://pm2.keymetrics.io/docs/usage/startup/)
- [Nginx: proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)
