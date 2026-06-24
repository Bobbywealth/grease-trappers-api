/**
 * src/routes/setup.js — one-time setup endpoints (delete after first use)
 *
 * Gated by SEED_TOKEN env var. Used to bootstrap the first admin user.
 * Will be removed after first deploy.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, DEMO_MODE } = require('../config/db');

const router = express.Router();

const SEED_TOKEN = process.env.SEED_TOKEN;

router.post('/create-admin', async (req, res) => {
  if (!SEED_TOKEN) return res.status(404).json({ message: 'Setup disabled (no SEED_TOKEN)' });
  const token = req.headers['x-seed-token'];
  if (token !== SEED_TOKEN) return res.status(401).json({ message: 'Invalid seed token' });
  if (DEMO_MODE) return res.status(400).json({ message: 'Cannot seed in DEMO_MODE' });

  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'email, password, name required' });
    }
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, is_active)
       VALUES ($1, $2, $3, 'admin', TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = TRUE
       RETURNING id, email, name, role`,
      [email.toLowerCase(), hash, name]
    );
    res.status(201).json({ message: 'Admin user created/updated', user: r.rows[0] });
  } catch (err) {
    console.error('seed admin:', err);
    res.status(500).json({ message: 'Seed failed', error: err.message });
  }
});

module.exports = router;