/**
 * src/routes/contracts.js — Service contracts (recurring agreements)
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const { customer_id, is_active } = req.query;
    const conditions = [];
    const params = [];
    if (customer_id) { params.push(parseInt(customer_id, 10)); conditions.push(`customer_id = $${params.length}`); }
    if (is_active !== undefined) { params.push(is_active === 'true'); conditions.push(`is_active = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT c.*, cu.business_name as customer_name, t.location_label as trap_location
       FROM service_contracts c LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN traps t ON t.id = c.trap_id
       ${where} ORDER BY c.start_date DESC LIMIT 500`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('list contracts:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const { customer_id, trap_id, service_frequency_days, price_per_visit, start_date, end_date, notes } = req.body;
    if (!customer_id) return res.status(400).json({ message: 'customer_id required' });
    const r = await pool.query(
      `INSERT INTO service_contracts (customer_id, trap_id, service_frequency_days, price_per_visit, start_date, end_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [customer_id, trap_id, service_frequency_days || 90, price_per_visit, start_date, end_date, notes]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('create contract:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const allowed = ['trap_id','service_frequency_days','price_per_visit','start_date','end_date','is_active','notes'];
    const sets = [];
    const params = [];
    for (const k of allowed) if (k in req.body) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ message: 'No valid fields' });
    sets.push('updated_at = NOW()');
    params.push(id);
    const r = await pool.query(`UPDATE service_contracts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows[0]) return res.status(404).json({ message: 'Contract not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('update contract:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ message: 'deleted' });
  try {
    await pool.query('UPDATE service_contracts SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ message: 'Contract deactivated' });
  } catch (err) {
    console.error('delete contract:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

module.exports = router;