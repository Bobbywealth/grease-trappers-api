/**
 * src/routes/vehicles.js — Trucks
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const r = await pool.query('SELECT * FROM vehicles ORDER BY label');
    res.json(r.rows);
  } catch (err) {
    console.error('list vehicles:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const { label, license_plate, capacity_gallons, last_maintenance_at } = req.body;
    if (!label) return res.status(400).json({ message: 'label required' });
    const r = await pool.query(
      'INSERT INTO vehicles (label, license_plate, capacity_gallons, last_maintenance_at) VALUES ($1,$2,$3,$4) RETURNING *',
      [label, license_plate, capacity_gallons, last_maintenance_at]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('create vehicle:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const allowed = ['label','license_plate','capacity_gallons','last_maintenance_at','is_active'];
    const sets = [];
    const params = [];
    for (const k of allowed) if (k in req.body) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ message: 'No valid fields' });
    params.push(id);
    const r = await pool.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows[0]) return res.status(404).json({ message: 'Vehicle not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('update vehicle:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ message: 'deleted' });
  try {
    await pool.query('UPDATE vehicles SET is_active = FALSE WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ message: 'Vehicle deactivated' });
  } catch (err) {
    console.error('delete vehicle:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

module.exports = router;