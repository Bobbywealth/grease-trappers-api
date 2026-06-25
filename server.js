/**
 * server.js — The Grease Trappers API
 *
 * Backend service for marketing site, manager CRM, and employee mobile app.
 * Tech: Node.js + Express + PostgreSQL.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { pool, initSchema, DEMO_MODE } = require('./src/config/db');

const authRoutes = require('./src/routes/auth');
const customersRoutes = require('./src/routes/customers');
const trapsRoutes = require('./src/routes/traps');
const jobsRoutes = require('./src/routes/jobs');
const usersRoutes = require('./src/routes/users');
const vehiclesRoutes = require('./src/routes/vehicles');
const timeClockRoutes = require('./src/routes/timeClock');
const locationsRoutes = require('./src/routes/locations');
const invoicesRoutes = require('./src/routes/invoices');
const dashboardRoutes = require('./src/routes/dashboard');
const quoteRequestsRoutes = require('./src/routes/quoteRequests');
const contractsRoutes = require('./src/routes/contracts');
const setupRoutes = require('./src/routes/setup');
const marketingRoutes = require('./src/routes/marketing');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('tiny'));

// Health check (unauthenticated)
app.get('/api/health', async (req, res) => {
  const status = { status: 'ok', timestamp: new Date().toISOString(), demo_mode: DEMO_MODE };
  if (!DEMO_MODE) {
    try {
      await pool.query('SELECT 1');
      status.db = 'connected';
    } catch (err) {
      status.db = 'error';
      status.db_error = err.message;
    }
  }
  res.json(status);
});

// Public routes (no auth)
app.use('/api/auth', authRoutes);
app.use('/api/quote-requests', quoteRequestsRoutes);

// Protected routes
app.use('/api/customers', customersRoutes);
app.use('/api/traps', trapsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/time-clock', timeClockRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/marketing', marketingRoutes);

// 404
app.use('/api', (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5000;

async function start() {
  await initSchema();
  app.listen(PORT, () => {
    console.log(`[server] Grease Trappers API listening on :${PORT} (DEMO_MODE=${DEMO_MODE})`);
  });
}

start().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});