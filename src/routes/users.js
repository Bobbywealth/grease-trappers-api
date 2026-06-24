/**
 * src/routes/users.js — Employee/manager CRUD
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/users — list (admin/manager only)
router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const { role, is_active } = req.query;
    const conditions = [];
    const params = [];
    if (role) { params.push(role); conditions.push(`role = $${params.length}`); }
    if (is_active !== undefined) { params.push(is_active === 'true'); conditions.push(`is_active = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT id, email, name, phone, role, is_active, last_login_at, created_at FROM users ${where} ORDER BY name`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('list users:', err);
    res.status(500).json({ message: 'Failed to list users' });
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.query });
  try {
    const id = parseInt(req.params.id, 10);
    // Users can view themselves; admins/managers can view anyone
    if (req.user.id !== id && !['admin','manager'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const r = await pool.query(
      'SELECT id, email, name, phone, role, is_active, last_login_at, created_at FROM users WHERE id = $1',
      [id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('get user:', err);
    res.status(500).json({ message: 'Failed to load user' });
  }
});

// POST /api/users — create (admin only)
router.post('/', requireRole('admin'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const { email, password, name, phone, role } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'email, password, name required' });
    }
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (email, password_hash, name, phone, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, phone, role, is_active, created_at`,
      [email.toLowerCase(), hash, name, phone, role || 'employee']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email already in use' });
    console.error('create user:', err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

// PUT /api/users/:id — admin can update anyone; users can update themselves (name/phone only)
router.put('/:id', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const isSelf = req.user.id === id;
    const isAdmin = req.user.role === 'admin';

    const allowed = ['name', 'phone', 'role', 'is_active'];
    if (isAdmin) allowed.push('email');
    if (!isAdmin && !isSelf) return res.status(403).json({ message: 'Forbidden' });
    if (!isAdmin) allowed.splice(allowed.indexOf('role'), 1);
    if (!isAdmin) allowed.splice(allowed.indexOf('is_active'), 1);

    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (k in req.body) {
        params.push(req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if ('password' in req.body && (isAdmin || isSelf)) {
      params.push(await bcrypt.hash(req.body.password, 10));
      sets.push(`password_hash = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ message: 'No valid fields' });
    sets.push('updated_at = NOW()');
    params.push(id);
    const r = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, email, name, phone, role, is_active, last_login_at, created_at`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('update user:', err);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// DELETE /api/users/:id — soft-delete (admin only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  if (DEMO_MODE) return res.json({ message: 'deleted' });
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    console.error('delete user:', err);
    res.status(500).json({ message: 'Failed to deactivate user' });
  }
});

module.exports = router;