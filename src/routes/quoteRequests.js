/**
 * src/routes/quoteRequests.js — Public quote request form (marketing site)
 *
 * No auth required — anyone visiting the marketing site can submit.
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');

const router = express.Router();

const VALID_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'one_time', 'other'];

router.post('/', async (req, res) => {
  try {
    const { name, business_name, email, phone, trap_size, service_frequency, message } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email' });
    }
    const frequency = VALID_FREQUENCIES.includes(service_frequency) ? service_frequency : 'other';

    if (DEMO_MODE) {
      return res.status(201).json({ id: 'demo', message: 'Quote request received (demo mode)' });
    }

    const r = await pool.query(
      `INSERT INTO quote_requests (name, business_name, email, phone, trap_size, service_frequency, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [name, business_name, email, phone, trap_size, frequency, message]
    );
    res.status(201).json({ id: r.rows[0].id, created_at: r.rows[0].created_at, message: 'Quote request received' });
  } catch (err) {
    console.error('quote request:', err);
    res.status(500).json({ message: 'Failed to submit quote request' });
  }
});

module.exports = router;