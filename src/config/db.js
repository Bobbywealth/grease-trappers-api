/**
 * src/config/db.js — PostgreSQL pool + schema bootstrapping.
 *
 * Tables are created here on first boot. Idempotent: safe to re-run.
 * For local dev, set DATABASE_URL in .env or run with no env (DEMO_MODE).
 */

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const DEMO_MODE = !DATABASE_URL;

let pool = null;
if (!DEMO_MODE) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('PG pool error:', err.message));
}

// Schema bootstrap — runs once on first boot. Each statement idempotent.
const SCHEMA_SQL = `
-- Enable UUID extension for primary keys (optional, but useful)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS (managers + employees). Single table for both roles.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  role VARCHAR(50) NOT NULL DEFAULT 'employee',
  -- role: 'admin' | 'manager' | 'employee'
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CUSTOMERS (restaurants / food service)
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  business_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address VARCHAR(500),
  city VARCHAR(100),
  state VARCHAR(2) DEFAULT 'NJ',
  zip VARCHAR(10),
  notes TEXT,
  billing_email VARCHAR(255),
  payment_terms VARCHAR(50) DEFAULT 'net30',
  -- net15 / net30 / due_on_receipt
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TRAPS (per-customer grease trap inventory)
CREATE TABLE IF NOT EXISTS traps (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  location_label VARCHAR(255),
  -- e.g. "Kitchen", "Roof", "Side lot"
  size_gallons INTEGER,
  -- trap capacity in gallons
  install_date DATE,
  last_pumped_at DATE,
  service_frequency_days INTEGER DEFAULT 90,
  -- 30 / 60 / 90 / 180 days
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SERVICE CONTRACTS (recurring agreements)
CREATE TABLE IF NOT EXISTS service_contracts (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  trap_id INTEGER REFERENCES traps(id) ON DELETE SET NULL,
  service_frequency_days INTEGER DEFAULT 90,
  price_per_visit DECIMAL(10, 2),
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- VEHICLES (trucks)
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  label VARCHAR(100),
  -- e.g. "Truck 1"
  license_plate VARCHAR(50),
  capacity_gallons INTEGER,
  last_maintenance_at DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- JOBS (work orders)
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  trap_id INTEGER REFERENCES traps(id) ON DELETE SET NULL,
  contract_id INTEGER REFERENCES service_contracts(id) ON DELETE SET NULL,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- single assigned employee (lead). For crews, see job_crew below.
  scheduled_date DATE,
  scheduled_time TIME,
  estimated_duration_minutes INTEGER,
  status VARCHAR(50) DEFAULT 'scheduled',
  -- 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'skipped'
  priority VARCHAR(20) DEFAULT 'normal',
  -- 'low' | 'normal' | 'high' | 'urgent'
  service_type VARCHAR(50) DEFAULT 'pump',
  -- 'pump' | 'inspect' | 'clean' | 'emergency' | 'install'
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_notes TEXT,
  waste_volume_gallons DECIMAL(10, 2),
  disposal_site VARCHAR(255),
  -- For NJDEP manifest
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- JOB CREW (multiple employees per job)
CREATE TABLE IF NOT EXISTS job_crew (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'crew',
  -- 'lead' | 'crew'
  clocked_in_at TIMESTAMP WITH TIME ZONE,
  clocked_out_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(job_id, user_id)
);

-- JOB PHOTOS (before/after, compliance proof)
CREATE TABLE IF NOT EXISTS job_photos (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  photo_url VARCHAR(500) NOT NULL,
  photo_type VARCHAR(20) DEFAULT 'after',
  -- 'before' | 'after' | 'other'
  caption VARCHAR(500),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- JOB SIGNATURES (customer sign-off on completion)
CREATE TABLE IF NOT EXISTS job_signatures (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  signature_data TEXT,
  -- base64-encoded signature image
  signer_name VARCHAR(255),
  signed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TIME CLOCK (employee shift clock in/out)
CREATE TABLE IF NOT EXISTS time_clock (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  clock_in_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  clock_out_at TIMESTAMP WITH TIME ZONE,
  clock_in_lat DECIMAL(10, 7),
  clock_in_lng DECIMAL(10, 7),
  clock_out_lat DECIMAL(10, 7),
  clock_out_lng DECIMAL(10, 7),
  clock_in_address VARCHAR(500),
  clock_out_address VARCHAR(500),
  -- Geocoded reverse lookup (best-effort, optional)
  total_hours DECIMAL(5, 2),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- LOCATION PINGS (GPS while employee is on the clock)
CREATE TABLE IF NOT EXISTS location_pings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  accuracy_meters DECIMAL(8, 2),
  battery_pct INTEGER,
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_location_pings_user_time ON location_pings(user_id, captured_at DESC);

-- INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  amount DECIMAL(10, 2) NOT NULL,
  tax DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',
  -- 'draft' | 'sent' | 'paid' | 'voided' | 'overdue'
  issue_date DATE DEFAULT CURRENT_DATE,
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PAYMENTS (manual tracking, Stripe will hook in later)
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  method VARCHAR(50),
  -- 'cash' | 'check' | 'ach' | 'card' | 'other'
  reference VARCHAR(255),
  paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- WASTE MANIFESTS (NJDEP-required documentation)
CREATE TABLE IF NOT EXISTS waste_manifests (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  manifest_number VARCHAR(100),
  volume_gallons DECIMAL(10, 2) NOT NULL,
  pickup_at TIMESTAMP WITH TIME ZONE,
  disposal_facility VARCHAR(255),
  disposal_at TIMESTAMP WITH TIME ZONE,
  generator_name VARCHAR(255),
  -- the customer (generator)
  transporter_name VARCHAR(255) DEFAULT 'The Grease Trappers',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ACTIVITY LOGS (audit trail)
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  -- 'login' | 'logout' | 'create_customer' | 'update_job' | ...
  resource_type VARCHAR(50),
  resource_id INTEGER,
  details JSONB,
  ip_address VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_time ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_resource ON activity_logs(resource_type, resource_id);

-- QUOTE REQUESTS (from marketing site contact form)
CREATE TABLE IF NOT EXISTS quote_requests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  trap_size VARCHAR(100),
  service_frequency VARCHAR(50),
  message TEXT,
  status VARCHAR(20) DEFAULT 'new',
  -- 'new' | 'contacted' | 'quoted' | 'won' | 'lost'
  converted_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SMS CAMPAIGNS (marketing blasts)
CREATE TABLE IF NOT EXISTS sms_campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  audience_type VARCHAR(50) NOT NULL,
  -- 'all' | 'by_city' | 'by_frequency' | 'manual'
  audience_filter JSONB,
  -- { cities: [...], frequencies: [...], customer_ids: [...] }
  scheduled_for TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(30) DEFAULT 'draft',
  -- 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed'
  recipient_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_campaigns_status ON sms_campaigns(status, created_at DESC);

-- SMS MESSAGES (per-recipient records)
CREATE TABLE IF NOT EXISTS sms_messages (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES sms_campaigns(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  to_phone VARCHAR(50) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(30) DEFAULT 'queued',
  -- 'queued' | 'sent' | 'delivered' | 'failed'
  provider_id VARCHAR(100),
  -- Twilio Message SID etc.
  error TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_campaign ON sms_messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_sms_messages_customer ON sms_messages(customer_id, created_at DESC);

-- SMS TEMPLATES (reusable message library)
CREATE TABLE IF NOT EXISTS sms_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  -- 'reminder' | 'promo' | 'maintenance' | 'seasonal' | 'general'
  body TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

async function initSchema() {
  if (DEMO_MODE) {
    console.log('[db] DEMO_MODE: skipping schema init');
    return;
  }
  console.log('[db] initializing schema...');
  try {
    await pool.query(SCHEMA_SQL);
    console.log('[db] schema ready');
  } catch (err) {
    console.error('[db] schema init failed:', err.message);
    throw err;
  }
}

module.exports = { pool, initSchema, DEMO_MODE };