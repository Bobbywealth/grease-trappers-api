/**
 * src/routes/timeClock.js — Employee clock in/out with GPS
 */
const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { reverseGeocode } = require('../utils/geocode');

const router = express.Router();
router.use(authenticate);

// GET /api/time-clock/me — current open shift for me (or null)
router.get('/me', async (req, res) => {
  if (DEMO_MODE) return res.json(null);
  try {
    const r = await pool.query(
      'SELECT * FROM time_clock WHERE user_id = $1 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1',
      [req.user.id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error('get my shift:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

// GET /api/time-clock — list (admin/manager only)
router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const { user_id, since, open_only } = req.query;
    const conditions = [];
    const params = [];
    if (user_id) { params.push(parseInt(user_id, 10)); conditions.push(`user_id = $${params.length}`); }
    if (since) { params.push(since); conditions.push(`clock_in_at >= $${params.length}`); }
    if (open_only === 'true') conditions.push(`clock_out_at IS NULL`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT tc.*, u.name as user_name, u.role as user_role
       FROM time_clock tc LEFT JOIN users u ON u.id = tc.user_id
       ${where} ORDER BY clock_in_at DESC LIMIT 200`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('list time-clock:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

// POST /api/time-clock/clock-in
router.post('/clock-in', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, user_id: req.user.id, ...req.body });
  try {
    const { lat, lng } = req.body;
    // Reverse geocode if no address provided
    let address = req.body.address;
    if (!address && lat != null && lng != null) {
      address = await reverseGeocode(lat, lng);
    }
    // Check no existing open shift
    const existing = await pool.query(
      'SELECT id FROM time_clock WHERE user_id = $1 AND clock_out_at IS NULL',
      [req.user.id]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ message: 'Already clocked in', open_shift_id: existing.rows[0].id });
    }
    const r = await pool.query(
      'INSERT INTO time_clock (user_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_address) VALUES ($1, NOW(), $2, $3, $4) RETURNING *',
      [req.user.id, lat, lng, address]
    );
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'clock_in', JSON.stringify({ lat, lng, address })]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('clock in:', err);
    res.status(500).json({ message: 'Failed to clock in' });
  }
});

// POST /api/time-clock/clock-out
router.post('/clock-out', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, user_id: req.user.id, ...req.body });
  try {
    const { lat, lng } = req.body;
    let address = req.body.address;
    if (!address && lat != null && lng != null) {
      address = await reverseGeocode(lat, lng);
    }
    const notes = req.body.notes;
    const open = await pool.query(
      'SELECT id, clock_in_at FROM time_clock WHERE user_id = $1 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1',
      [req.user.id]
    );
    if (!open.rows[0]) {
      return res.status(409).json({ message: 'Not clocked in' });
    }
    const id = open.rows[0].id;
    const clockIn = new Date(open.rows[0].clock_in_at);
    const totalHours = ((Date.now() - clockIn.getTime()) / 3600000).toFixed(2);
    const r = await pool.query(
      'UPDATE time_clock SET clock_out_at = NOW(), clock_out_lat = $1, clock_out_lng = $2, clock_out_address = $3, total_hours = $4, notes = $5 WHERE id = $6 RETURNING *',
      [lat, lng, address, totalHours, notes, id]
    );
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'clock_out', JSON.stringify({ total_hours: totalHours, address })]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('clock out:', err);
    res.status(500).json({ message: 'Failed to clock out' });
  }
});

module.exports = router;