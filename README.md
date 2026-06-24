# Grease Trappers API

Backend service for The Grease Trappers CRM + employee mobile + marketing site.

**Stack:** Node.js + Express + PostgreSQL
**Database:** Render Postgres (grease-trappers-db)
**Hosting:** Render (auto-deploy on push to main)

## API Endpoints

### Public (no auth)
- `POST /api/auth/login` — login
- `POST /api/quote-requests` — marketing site form submission
- `GET /api/health` — health check

### Manager CRM (auth required, role: admin | manager | employee)
- `GET /api/customers` — list restaurants/businesses
- `POST /api/customers` — create
- `GET /api/customers/:id` — detail + traps + recent jobs + invoices
- `PUT /api/customers/:id` — update
- `DELETE /api/customers/:id` — soft-delete
- `GET /api/traps?customer_id=X` — list traps per customer
- `POST /api/traps` / `PUT /api/traps/:id` / `DELETE /api/traps/:id`
- `GET /api/jobs` — list jobs (filterable)
- `GET /api/jobs/today` — today's jobs for current employee
- `GET /api/jobs/:id` — detail + crew + photos + signature
- `POST /api/jobs` / `PUT /api/jobs/:id` / `DELETE /api/jobs/:id`
- `POST /api/jobs/:id/photos` — add photo URL
- `POST /api/jobs/:id/sign` — customer signature
- `GET /api/contracts` — recurring service agreements
- `POST /api/contracts` / `PUT /api/contracts/:id`
- `GET /api/invoices` / `POST /api/invoices` / `PUT /api/invoices/:id`
- `POST /api/invoices/:id/payments` — record payment
- `GET /api/users` / `POST /api/users` / `PUT /api/users/:id`
- `GET /api/vehicles` / `POST /api/vehicles`
- `GET /api/time-clock` — all shifts (admin/manager)
- `GET /api/time-clock/me` — my open shift
- `POST /api/time-clock/clock-in` — clock in with GPS
- `POST /api/time-clock/clock-out` — clock out with GPS
- `POST /api/locations` — single or batch GPS pings
- `GET /api/locations/user/:id` — recent pings for a user
- `GET /api/locations/active` — latest ping for all clocked-in users
- `GET /api/dashboard/stats` — manager dashboard KPIs
- `GET /api/dashboard/employee-stats` — field app home screen KPIs

## Data Model

13 tables (see `src/config/db.js` for full schema):
- `users` — managers + employees (role-based)
- `customers` — restaurants/businesses
- `traps` — per-customer grease trap inventory
- `service_contracts` — recurring agreements
- `jobs` — work orders (scheduled/in_progress/completed/cancelled)
- `job_crew` — multiple employees per job
- `job_photos` — before/after photos
- `job_signatures` — customer sign-off
- `time_clock` — shift clock-in/out records
- `location_pings` — GPS trail while on the clock
- `invoices` + `payments` — billing
- `waste_manifests` — NJDEP-required documentation
- `activity_logs` — audit trail
- `quote_requests` — marketing form submissions

## Local Development

```bash
# Without a database (DEMO_MODE — all reads return []; auth hardcoded demo user)
npm install
npm start

# With a local Postgres
cp .env.example .env
# Set DATABASE_URL=postgresql://...
npm install
npm start
```

Demo credentials (in DEMO_MODE): `admin@greasetrapers.com / demo123`

## Render Deployment

`render.yaml` defines the web service. Database connection is auto-injected from
the `grease-trappers-db` Postgres instance. Auto-deploy on push to `main`.

`JWT_SECRET` is auto-generated on first deploy.