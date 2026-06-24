/**
 * src/routes/customers.js — Customer (restaurant) CRUD
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/customers — list with optional search
router.get('/', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const { search, is_active } = req.query;
    const conditions = [];
    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(business_name) LIKE $${params.length} OR LOWER(contact_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`);
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true');
      conditions.push(`is_active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await pool.query(`SELECT * FROM customers ${where} ORDER BY business_name ASC LIMIT 500`, params);
    res.json(r.rows);
  } catch (err) {
    console.error('list customers:', err);
    res.status(500).json({ message: 'Failed to list customers' });
  }
});

// GET /api/customers/:id — detail + traps + recent jobs
router.get('/:id', async (req, res) => {
  if (DEMO_MODE) return res.status(404).json({ message: 'Not found' });
  try {
    const id = parseInt(req.params.id, 10);
    const c = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ message: 'Customer not found' });
    const traps = await pool.query('SELECT * FROM traps WHERE customer_id = $1 ORDER BY location_label', [id]);
    const contracts = await pool.query('SELECT * FROM service_contracts WHERE customer_id = $1 ORDER BY start_date DESC', [id]);
    const recentJobs = await pool.query(
      `SELECT j.*, u.name as assigned_name FROM jobs j
       LEFT JOIN users u ON u.id = j.assigned_to
       WHERE j.customer_id = $1 ORDER BY j.scheduled_date DESC LIMIT 25`,
      [id]
    );
    const invoices = await pool.query(
      'SELECT * FROM invoices WHERE customer_id = $1 ORDER BY issue_date DESC LIMIT 25',
      [id]
    );
    res.json({
      ...c.rows[0],
      traps: traps.rows,
      contracts: contracts.rows,
      recent_jobs: recentJobs.rows,
      invoices: invoices.rows,
    });
  } catch (err) {
    console.error('get customer:', err);
    res.status(500).json({ message: 'Failed to load customer' });
  }
});

// POST /api/customers — create (admin/manager)
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const {
      business_name, contact_name, email, phone, address,
      city, state, zip, notes, billing_email, payment_terms,
    } = req.body;
    if (!business_name) return res.status(400).json({ message: 'business_name is required' });
    const r = await pool.query(
      `INSERT INTO customers (business_name, contact_name, email, phone, address, city, state, zip, notes, billing_email, payment_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [business_name, contact_name, email, phone, address, city, state || 'NJ', zip, notes, billing_email, payment_terms || 'net30']
    );
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, resource_type, resource_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'create_customer', 'customer', r.rows[0].id, JSON.stringify({ business_name })]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('create customer:', err);
    res.status(500).json({ message: 'Failed to create customer' });
  }
});

// PUT /api/customers/:id — update
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const allowed = ['business_name','contact_name','email','phone','address','city','state','zip','notes','billing_email','payment_terms','is_active'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (k in req.body) {
        params.push(req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ message: 'No valid fields to update' });
    sets.push('updated_at = NOW()');
    params.push(id);
    const r = await pool.query(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Customer not found' });
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4)',
      [req.user.id, 'update_customer', 'customer', id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('update customer:', err);
    res.status(500).json({ message: 'Failed to update customer' });
  }
});

// DELETE /api/customers/:id — soft-delete (is_active=false)
router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ message: 'deleted' });
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('UPDATE customers SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4)',
      [req.user.id, 'deactivate_customer', 'customer', id]
    );
    res.json({ message: 'Customer deactivated' });
  } catch (err) {
    console.error('delete customer:', err);
    res.status(500).json({ message: 'Failed to delete customer' });
  }
});

module.exports = router;