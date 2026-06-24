/**
 * src/routes/locations.js — GPS pings from employee mobile app
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// POST /api/locations — employee reports location (single or batch)
router.post('/', async (req, res) => {
  if (DEMO_MODE) return res.json({ count: Array.isArray(req.body) ? req.body.length : 1 });
  try {
    const points = Array.isArray(req.body) ? req.body : [req.body];
    const inserted = [];
    for (const p of points) {
      const { lat, lng, job_id, accuracy_meters, battery_pct, captured_at } = p;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const r = await pool.query(
        `INSERT INTO location_pings (user_id, job_id, lat, lng, accuracy_meters, battery_pct, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, NOW())) RETURNING id`,
        [req.user.id, job_id, lat, lng, accuracy_meters, battery_pct, captured_at]
      );
      inserted.push(r.rows[0].id);
    }
    res.json({ count: inserted.length, ids: inserted });
  } catch (err) {
    console.error('location insert:', err);
    res.status(500).json({ message: 'Failed to log location' });
  }
});

// GET /api/locations/user/:id — recent pings for a user (admin/manager only)
router.get('/user/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const id = parseInt(req.params.id, 10);
    const since = req.query.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await pool.query(
      'SELECT * FROM location_pings WHERE user_id = $1 AND captured_at >= $2 ORDER BY captured_at DESC LIMIT 1000',
      [id, since]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('location list:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

// GET /api/locations/active — last ping for all currently-clocked-in employees
router.get('/active', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const r = await pool.query(`
      WITH active_users AS (
        SELECT user_id FROM time_clock WHERE clock_out_at IS NULL
      ),
      latest_ping AS (
        SELECT DISTINCT ON (user_id) user_id, lat, lng, captured_at
        FROM location_pings
        WHERE user_id IN (SELECT user_id FROM active_users)
        ORDER BY user_id, captured_at DESC
      )
      SELECT u.id as user_id, u.name, u.role,
             lp.lat, lp.lng, lp.captured_at as last_ping_at
      FROM active_users au
      JOIN users u ON u.id = au.user_id
      LEFT JOIN latest_ping lp ON lp.user_id = au.user_id
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('active locations:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

module.exports = router;