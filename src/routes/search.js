const express = require('express');
const router = express.Router();
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/search?q=foo
// Searches across customers, jobs, invoices, vehicles, users.
// Returns up to 8 hits per group, each with type, id, title, subtitle, and a deep-link path.
router.get('/', async (req, res) => {
  if (DEMO_MODE) return res.json({ q: req.query.q || '', groups: [], total: 0 });
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ q, groups: [], total: 0 });
  }
  const needle = `%${q.toLowerCase()}%`;

  try {
    const [cust, jobs, inv, veh, usr] = await Promise.all([
      pool.query(
        `SELECT id, business_name as title, contact_name as sub, city as meta, 'customer' as type
         FROM customers
         WHERE is_active = TRUE
           AND (LOWER(business_name) LIKE $1
                OR LOWER(contact_name) LIKE $1
                OR LOWER(email) LIKE $1
                OR LOWER(phone) LIKE $1
                OR LOWER(city) LIKE $1
                OR LOWER(address) LIKE $1)
         ORDER BY business_name ASC
         LIMIT 8`,
        [needle]
      ),
      pool.query(
        `SELECT j.id,
                '#' || j.id || ' · ' || COALESCE(c.business_name, 'Customer') as title,
                COALESCE(j.scheduled_date::text, 'unscheduled') || COALESCE(' · ' || j.scheduled_time, '') as sub,
                j.status as meta,
                'job' as type
         FROM jobs j
         LEFT JOIN customers c ON c.id = j.customer_id
         WHERE LOWER(COALESCE(c.business_name, '')) LIKE $1
            OR LOWER(j.notes) LIKE $1
            OR CAST(j.id AS TEXT) LIKE $1
         ORDER BY j.scheduled_date DESC NULLS LAST
         LIMIT 8`,
        [needle]
      ),
      pool.query(
        `SELECT i.id,
                i.invoice_number as title,
                '$' || i.total::text || ' · ' || COALESCE(c.business_name, 'Customer') as sub,
                i.status as meta,
                'invoice' as type
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
         WHERE LOWER(COALESCE(i.invoice_number, '')) LIKE $1
            OR LOWER(COALESCE(c.business_name, '')) LIKE $1
         ORDER BY i.issue_date DESC NULLS LAST
         LIMIT 8`,
        [needle]
      ),
      pool.query(
        `SELECT id, label as title, COALESCE(license_plate, '') as sub, 'truck' as meta, 'vehicle' as type
         FROM vehicles
         WHERE LOWER(COALESCE(label, '')) LIKE $1
            OR LOWER(COALESCE(license_plate, '')) LIKE $1
         ORDER BY label ASC
         LIMIT 8`,
        [needle]
      ),
      pool.query(
        `SELECT id, name as title, email as sub, role as meta, 'user' as type
         FROM users
         WHERE is_active = TRUE
           AND (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)
         ORDER BY name ASC
         LIMIT 8`,
        [needle]
      ),
    ]);

    const path = {
      customer: (id) => `/customers/${id}`,
      job:      (id) => `/jobs/${id}`,
      invoice:  (id) => `/invoices`,
      vehicle:  (id) => `/vehicles`,
      user:     (id) => `/staff`,
    };
    const decorate = (rows) => rows.map(r => ({ ...r, path: path[r.type]?.(r.id) || '/' }));

    const groups = [
      { label: 'Customers', type: 'customer', hits: decorate(cust.rows) },
      { label: 'Jobs',      type: 'job',      hits: decorate(jobs.rows) },
      { label: 'Invoices',  type: 'invoice',  hits: decorate(inv.rows) },
      { label: 'Vehicles',  type: 'vehicle',  hits: decorate(veh.rows) },
      { label: 'Staff',     type: 'user',     hits: decorate(usr.rows) },
    ].filter(g => g.hits.length > 0);

    const total = groups.reduce((sum, g) => sum + g.hits.length, 0);
    res.json({ q, groups, total });
  } catch (err) {
    console.error('search:', err);
    res.status(500).json({ message: 'Search failed' });
  }
});

module.exports = router;