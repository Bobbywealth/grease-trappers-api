/**
 * src/routes/jobs.js — Work orders (scheduled, in-progress, completed)
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/jobs — list with filters
router.get('/', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const { status, assigned_to, customer_id, scheduled_from, scheduled_to, search, sort } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`j.status = $${params.length}`); }
    if (assigned_to) { params.push(parseInt(assigned_to, 10)); conditions.push(`j.assigned_to = $${params.length}`); }
    if (customer_id) { params.push(parseInt(customer_id, 10)); conditions.push(`j.customer_id = $${params.length}`); }
    if (scheduled_from) { params.push(scheduled_from); conditions.push(`j.scheduled_date >= $${params.length}`); }
    if (scheduled_to) { params.push(scheduled_to); conditions.push(`j.scheduled_date <= $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(j.notes ILIKE $${params.length} OR c.business_name ILIKE $${params.length})`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortCol = sort === 'oldest' ? 'j.scheduled_date ASC, j.scheduled_time ASC' : 'j.scheduled_date ASC, j.scheduled_time ASC';
    const r = await pool.query(
      `SELECT j.*, c.business_name as customer_name, c.address as customer_address,
              c.city as customer_city, t.location_label as trap_location,
              u.name as assigned_name, v.label as vehicle_label
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN traps t ON t.id = j.trap_id
       LEFT JOIN users u ON u.id = j.assigned_to
       LEFT JOIN vehicles v ON v.id = j.vehicle_id
       ${where}
       ORDER BY ${sortCol}
       LIMIT 500`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('list jobs:', err);
    res.status(500).json({ message: 'Failed to list jobs' });
  }
});

// GET /api/jobs/today — for the employee mobile app
router.get('/today', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT j.*, c.business_name as customer_name, c.address as customer_address,
              c.city as customer_city, t.location_label as trap_location,
              u.name as assigned_name, v.label as vehicle_label
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN traps t ON t.id = j.trap_id
       LEFT JOIN users u ON u.id = j.assigned_to
       LEFT JOIN vehicles v ON v.id = j.vehicle_id
       WHERE j.scheduled_date = CURRENT_DATE
         AND (j.assigned_to = $1 OR j.id IN (SELECT job_id FROM job_crew WHERE user_id = $1))
       ORDER BY j.scheduled_time ASC NULLS LAST`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('list today:', err);
    res.status(500).json({ message: 'Failed to load today\'s jobs' });
  }
});

// GET /api/jobs/:id — detail
router.get('/:id', async (req, res) => {
  if (DEMO_MODE) return res.status(404).json({ message: 'Not found' });
  try {
    const id = parseInt(req.params.id, 10);
    const r = await pool.query(
      `SELECT j.*, c.business_name, c.address, c.city, c.contact_name, c.contact_phone,
              u.name as assigned_name, v.label as vehicle_label
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN users u ON u.id = j.assigned_to
       LEFT JOIN vehicles v ON v.id = j.vehicle_id
       WHERE j.id = $1`,
      [id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Job not found' });
    const crew = await pool.query(
      `SELECT jc.*, u.name FROM job_crew jc LEFT JOIN users u ON u.id = jc.user_id WHERE jc.job_id = $1`,
      [id]
    );
    const photos = await pool.query('SELECT * FROM job_photos WHERE job_id = $1 ORDER BY created_at DESC', [id]);
    const signature = await pool.query('SELECT * FROM job_signatures WHERE job_id = $1 ORDER BY signed_at DESC LIMIT 1', [id]);
    res.json({ ...r.rows[0], crew: crew.rows, photos: photos.rows, signature: signature.rows[0] || null });
  } catch (err) {
    console.error('get job:', err);
    res.status(500).json({ message: 'Failed to load job' });
  }
});

// POST /api/jobs — create
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const { customer_id, trap_id, contract_id, vehicle_id, assigned_to,
            scheduled_date, scheduled_time, estimated_duration_minutes,
            status, priority, service_type, notes } = req.body;
    if (!customer_id || !scheduled_date) {
      return res.status(400).json({ message: 'customer_id and scheduled_date required' });
    }
    const r = await pool.query(
      `INSERT INTO jobs (customer_id, trap_id, contract_id, vehicle_id, assigned_to,
                          scheduled_date, scheduled_time, estimated_duration_minutes,
                          status, priority, service_type, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [customer_id, trap_id, contract_id, vehicle_id, assigned_to,
       scheduled_date, scheduled_time, estimated_duration_minutes,
       status || 'scheduled', priority || 'normal', service_type || 'pump', notes]
    );
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, resource_type, resource_id) VALUES ($1,$2,$3,$4)',
      [req.user.id, 'create_job', 'job', r.rows[0].id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('create job:', err);
    res.status(500).json({ message: 'Failed to create job' });
  }
});

// PUT /api/jobs/:id — update
router.put('/:id', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const allowed = ['trap_id','contract_id','vehicle_id','assigned_to','scheduled_date','scheduled_time',
                     'estimated_duration_minutes','status','priority','service_type','notes',
                     'completion_notes','waste_volume_gallons','disposal_site','completed_at'];
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
      `UPDATE jobs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Job not found' });

    // Auto-update trap.last_pumped_at when job is completed
    if (req.body.status === 'completed' && r.rows[0].trap_id) {
      await pool.query(
        'UPDATE traps SET last_pumped_at = CURRENT_DATE, updated_at = NOW() WHERE id = $1',
        [r.rows[0].trap_id]
      );
    }

    await pool.query(
      'INSERT INTO activity_logs (user_id, action, resource_type, resource_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'update_job', 'job', id, JSON.stringify(req.body)]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('update job:', err);
    res.status(500).json({ message: 'Failed to update job' });
  }
});

// DELETE /api/jobs/:id
router.delete('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ message: 'deleted' });
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
    res.json({ message: 'Job deleted' });
  } catch (err) {
    console.error('delete job:', err);
    res.status(500).json({ message: 'Failed to delete job' });
  }
});

// POST /api/jobs/:id/photos — add a photo URL (upload happens client-side or S3)
router.post('/:id/photos', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const { photo_url, photo_type, caption } = req.body;
    if (!photo_url) return res.status(400).json({ message: 'photo_url required' });
    const r = await pool.query(
      'INSERT INTO job_photos (job_id, photo_url, photo_type, caption, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, photo_url, photo_type || 'after', caption, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('add photo:', err);
    res.status(500).json({ message: 'Failed to add photo' });
  }
});

// POST /api/jobs/:id/sign — customer signature on completion
router.post('/:id/sign', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const { signature_data, signer_name } = req.body;
    if (!signature_data || !signer_name) {
      return res.status(400).json({ message: 'signature_data and signer_name required' });
    }
    const r = await pool.query(
      'INSERT INTO job_signatures (job_id, signature_data, signer_name) VALUES ($1,$2,$3) RETURNING *',
      [id, signature_data, signer_name]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('sign job:', err);
    res.status(500).json({ message: 'Failed to save signature' });
  }
});

module.exports = router;