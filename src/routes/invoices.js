/**
 * src/routes/invoices.js — Invoicing + payment tracking
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const prefix = `INV-${year}${month}-`;
  const r = await pool.query(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  const lastNum = r.rows[0] ? parseInt(r.rows[0].invoice_number.split('-').pop(), 10) : 0;
  return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
}

// GET /api/invoices — list
router.get('/', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const { status, customer_id } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (customer_id) { params.push(parseInt(customer_id, 10)); conditions.push(`customer_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT i.*, c.business_name as customer_name FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       ${where} ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('list invoices:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

// GET /api/invoices/:id
router.get('/:id', async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id });
  try {
    const id = parseInt(req.params.id, 10);
    const r = await pool.query(
      `SELECT i.*, c.business_name, c.address, c.city, c.zip, c.contact_name, c.email as customer_email
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
      [id]
    );
    if (!r.rows[0]) return res.status(404).json({ message: 'Invoice not found' });
    const payments = await pool.query('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_at DESC', [id]);
    res.json({ ...r.rows[0], payments: payments.rows });
  } catch (err) {
    console.error('get invoice:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

// POST /api/invoices
router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const { customer_id, job_id, amount, tax, total, issue_date, due_date, notes } = req.body;
    if (!customer_id || !amount || total === undefined) {
      return res.status(400).json({ message: 'customer_id, amount, total required' });
    }
    const invoice_number = await nextInvoiceNumber();
    const r = await pool.query(
      `INSERT INTO invoices (invoice_number, customer_id, job_id, amount, tax, total, issue_date, due_date, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [invoice_number, customer_id, job_id, amount, tax || 0, total, issue_date || new Date(), due_date, notes, 'draft']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('create invoice:', err);
    res.status(500).json({ message: 'Failed to create invoice' });
  }
});

// PUT /api/invoices/:id — update (status, etc.)
router.put('/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: req.params.id, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const allowed = ['amount','tax','total','status','issue_date','due_date','notes'];
    const sets = [];
    const params = [];
    for (const k of allowed) if (k in req.body) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ message: 'No valid fields' });
    sets.push('updated_at = NOW()');
    params.push(id);
    const r = await pool.query(`UPDATE invoices SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows[0]) return res.status(404).json({ message: 'Invoice not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('update invoice:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

// POST /api/invoices/:id/payments — record a payment
router.post('/:id/payments', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ id: 1, ...req.body });
  try {
    const id = parseInt(req.params.id, 10);
    const { amount, method, reference, notes } = req.body;
    if (!amount) return res.status(400).json({ message: 'amount required' });
    const r = await pool.query(
      'INSERT INTO payments (invoice_id, amount, method, reference, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, amount, method, reference, notes]
    );
    // Mark invoice paid if total payments cover the total
    const sum = await pool.query('SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = $1', [id]);
    const inv = await pool.query('SELECT total FROM invoices WHERE id = $1', [id]);
    if (inv.rows[0] && parseFloat(sum.rows[0].paid) >= parseFloat(inv.rows[0].total)) {
      await pool.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', ['paid', id]);
    }
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('add payment:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

module.exports = router;