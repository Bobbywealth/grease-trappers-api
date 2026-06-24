/**
 * src/routes/traps.js — Grease trap inventory per customer
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/traps?customer_id=X
router.get('/', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const { customer_id } = req.query;
    if (!customer_id) return res.status(400).json({ message: 'customer_id required' });
    const r = await pool.query('SELECT * FROM traps WHERE customer_id = $1 ORDER BY location_label', [parseInt(customer_id, 10)]);
    res.json(r.rows);
  } catch (err) {
    console.error('list traps:', err);
    res.status(500).json({ message: 'Failed to list traps' });
  }
});

// POST /api/traps
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const { customer_id, location_label, size_gallons, install_date, service_frequency_days, notes } = req.body;
    if (!customer_id) return res.status(400).json({ message: 'customer_id required' });
    const r = await pool.query(
      `INSERT INTO traps (customer_id, location_label, size_gallons, install_date, service_frequency_days, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [customer_id, location_label, size_gallons, install_date, service_frequency_days || 90, notes]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('create trap:', err);
    res.status(500).json({ message: 'Failed to create trap' });
  }
});

// PUT /api/traps/:id
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const allowed = ['location_label', 'size_gallons', 'install_date', 'last_pumped_at', 'service_frequency_days', 'notes'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (k in req.body) {
        params.push(req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ message: 'No valid fields' });
    sets.push('updated_at = NOW()');
    params.push(id);
    const r = await pool.query(
      `UPDATE traps SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Trap not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('update trap:', err);
    res.status(500).json({ message: 'Failed to update trap' });
  }
});

// DELETE /api/traps/:id
router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ message: 'deleted' });
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM traps WHERE id = $1', [id]);
    res.json({ message: 'Trap deleted' });
  } catch (err) {
    console.error('delete trap:', err);
    res.status(500).json({ message: 'Failed to delete trap' });
  }
});

module.exports = router;