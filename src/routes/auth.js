/**
 * src/routes/auth.js — Login, logout, register (admin-only), me
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, DEMO_MODE } = require('../config/db');
const { signToken, authenticate } = require('../middleware/auth');

const router = express.Router();

// Demo seed (matches the seeded admin in Stays By Shay pattern — same credentials)
const DEMO_ADMIN = {
  email: 'admin@greasetrapers.com',
  password: 'demo123',
  name: 'Demo Admin',
  role: 'admin',
};

async function findUserByEmail(email) {
  if (DEMO_MODE) {
    if (email === DEMO_ADMIN.email) {
      return { id: 'demo', email, name: DEMO_ADMIN.name, role: DEMO_ADMIN.role, is_active: true };
    }
    return null;
  }
  const r = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return r.rows[0] || null;
}

async function verifyPassword(plaintext, hash) {
  if (DEMO_MODE) {
    return plaintext === DEMO_ADMIN.password;
  }
  return bcrypt.compare(plaintext, hash);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }
  try {
    const user = await findUserByEmail(email);
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const ok = await verifyPassword(password, user.password_hash || '');
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last_login_at
    if (!DEMO_MODE) {
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    }

    // Log activity
    if (!DEMO_MODE) {
      await pool.query(
        'INSERT INTO activity_logs (user_id, action, ip_address) VALUES ($1, $2, $3)',
        [user.id, 'login', req.ip]
      );
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  if (!DEMO_MODE) {
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [req.user.id, 'logout', req.ip]
    );
  }
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  if (DEMO_MODE) {
    return res.json({
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
    });
  }
  const r = await pool.query('SELECT id, email, name, role, phone FROM users WHERE id = $1', [req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'User not found' });
  res.json(r.rows[0]);
});

module.exports = router;