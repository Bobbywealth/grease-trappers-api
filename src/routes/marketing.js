const express = require('express');
const router = express.Router();
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSms, isStubMode: smsStub } = require('../services/sms');

router.use(authenticate);

// ===== AUDIENCE PREVIEW =====
// POST /api/marketing/audience/preview
// body: { type: 'all'|'by_city'|'by_frequency'|'manual', filter: {...} }
// Returns the customer list that would receive the campaign
router.post('/audience/preview', requireRole('admin', 'manager'), async (req, res) => {
  const { type, filter = {} } = req.body || {};
  if (DEMO_MODE) return res.json({ count: 0, customers: [] });
  try {
    let query = `SELECT id, business_name, contact_name, phone, city, state, service_frequency
                  FROM customers
                  WHERE is_active = TRUE
                    AND phone IS NOT NULL
                    AND phone <> ''`;
    const params = [];

    if (type === 'by_city' && Array.isArray(filter.cities) && filter.cities.length > 0) {
      const placeholders = filter.cities.map((_, i) => `$${params.length + i + 1}`).join(',');
      query += ` AND city IN (${placeholders})`;
      params.push(...filter.cities);
    } else if (type === 'by_frequency' && Array.isArray(filter.frequencies) && filter.frequencies.length > 0) {
      const placeholders = filter.frequencies.map((_, i) => `$${params.length + i + 1}`).join(',');
      query += ` AND service_frequency IN (${placeholders})`;
      params.push(...filter.frequencies);
    } else if (type === 'manual' && Array.isArray(filter.customer_ids) && filter.customer_ids.length > 0) {
      const placeholders = filter.customer_ids.map((_, i) => `$${params.length + i + 1}`).join(',');
      query += ` AND id IN (${placeholders})`;
      params.push(...filter.customer_ids);
    }

    query += ` ORDER BY business_name ASC`;
    const r = await pool.query(query, params);
    res.json({ count: r.rows.length, customers: r.rows });
  } catch (err) {
    console.error('audience preview:', err);
    res.status(500).json({ message: 'Failed to load audience' });
  }
});

// ===== TEMPLATES =====
// GET /api/marketing/templates
router.get('/templates', async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT id, name, category, body FROM sms_templates WHERE is_active = TRUE ORDER BY category, name`
    );
    if (r.rows.length === 0) {
      // Seed defaults on first read
      const defaults = [
        ['Service Reminder', 'reminder',
          'Hi {business_name}! Your grease trap is due for service. Reply YES to book, or call {phone}. — Grease Trappers'],
        ['Maintenance Plan', 'promo',
          'Save 15% on routine maintenance with our quarterly plan. Reply PLAN for details. — Grease Trappers'],
        ['Emergency Service', 'seasonal',
          'Holiday rush? We offer 24/7 emergency grease trap service. Call {phone} anytime.'],
        ['NJDEP Compliance', 'maintenance',
          'NJDEP compliance inspection due for {business_name}. Book your annual FOG audit — Grease Trappers'],
        ['Thank You', 'general',
          'Thanks for choosing Grease Trappers! Rate your service: reply 1-5 stars.'],
        ['Re-engagement', 'promo',
          'We miss you! Book a service this month and get $25 off. Reply BOOK — Grease Trappers'],
      ];
      for (const [name, category, body] of defaults) {
        await pool.query(
          `INSERT INTO sms_templates (name, category, body) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [name, category, body]
        );
      }
      const r2 = await pool.query(
        `SELECT id, name, category, body FROM sms_templates WHERE is_active = TRUE ORDER BY category, name`
      );
      return res.json(r2.rows);
    }
    res.json(r.rows);
  } catch (err) {
    console.error('list templates:', err);
    res.status(500).json({ message: 'Failed to load templates' });
  }
});

// ===== CAMPAIGNS =====
// GET /api/marketing/campaigns — list with summary stats
router.get('/campaigns', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT c.*, u.name as created_by_name
       FROM sms_campaigns c
       LEFT JOIN users u ON u.id = c.created_by
       ORDER BY c.created_at DESC
       LIMIT 100`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('list campaigns:', err);
    res.status(500).json({ message: 'Failed to load campaigns' });
  }
});

// GET /api/marketing/campaigns/:id — full detail with message log
router.get('/campaigns/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({});
  try {
    const c = await pool.query(`SELECT * FROM sms_campaigns WHERE id = $1`, [req.params.id]);
    if (!c.rows[0]) return res.status(404).json({ message: 'Campaign not found' });
    const msgs = await pool.query(
      `SELECT m.*, c.business_name, c.contact_name
       FROM sms_messages m
       LEFT JOIN customers c ON c.id = m.customer_id
       WHERE m.campaign_id = $1
       ORDER BY m.created_at DESC
       LIMIT 500`,
      [req.params.id]
    );
    res.json({ ...c.rows[0], messages: msgs.rows });
  } catch (err) {
    console.error('get campaign:', err);
    res.status(500).json({ message: 'Failed to load campaign' });
  }
});

// POST /api/marketing/campaigns — create draft
// body: { name, body, audience_type, audience_filter, scheduled_for? }
router.post('/campaigns', requireRole('admin', 'manager'), async (req, res) => {
  const { name, body, audience_type, audience_filter = {}, scheduled_for = null } = req.body || {};
  if (!name || !body || !audience_type) {
    return res.status(400).json({ message: 'name, body, and audience_type are required' });
  }
  if (DEMO_MODE) return res.json({ id: 1 });
  try {
    const status = scheduled_for ? 'scheduled' : 'draft';
    const r = await pool.query(
      `INSERT INTO sms_campaigns (name, body, audience_type, audience_filter, scheduled_for, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, body, audience_type, audience_filter, scheduled_for, status, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('create campaign:', err);
    res.status(500).json({ message: 'Failed to create campaign' });
  }
});

// POST /api/marketing/campaigns/:id/send — actually send (or schedule via cron)
// Resolves audience from filter, inserts sms_messages rows, marks sent.
// NOTE: This is a STUB — it marks messages as 'sent' but does not actually
// hit Twilio. Wire TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER
// env vars + a real Twilio client to enable delivery.
router.post('/campaigns/:id/send', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ sent: 0 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the campaign row
    const c = await client.query(
      `SELECT * FROM sms_campaigns WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!c.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Campaign not found' });
    }
    if (c.rows[0].status === 'sent') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Campaign already sent' });
    }

    const campaign = c.rows[0];
    const filter = campaign.audience_filter || {};
    let audienceQuery = `SELECT id, business_name, contact_name, phone FROM customers WHERE is_active = TRUE AND phone IS NOT NULL AND phone <> ''`;
    const params = [];

    if (campaign.audience_type === 'by_city' && Array.isArray(filter.cities) && filter.cities.length > 0) {
      const placeholders = filter.cities.map((_, i) => `$${params.length + i + 1}`).join(',');
      audienceQuery += ` AND city IN (${placeholders})`;
      params.push(...filter.cities);
    } else if (campaign.audience_type === 'by_frequency' && Array.isArray(filter.frequencies) && filter.frequencies.length > 0) {
      const placeholders = filter.frequencies.map((_, i) => `$${params.length + i + 1}`).join(',');
      audienceQuery += ` AND service_frequency IN (${placeholders})`;
      params.push(...filter.frequencies);
    } else if (campaign.audience_type === 'manual' && Array.isArray(filter.customer_ids) && filter.customer_ids.length > 0) {
      const placeholders = filter.customer_ids.map((_, i) => `$${params.length + i + 1}`).join(',');
      audienceQuery += ` AND id IN (${placeholders})`;
      params.push(...filter.customer_ids);
    }

    const aud = await client.query(audienceQuery, params);
    const customers = aud.rows;

    if (customers.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No customers match the audience filter' });
    }

    // Personalize + send via Twilio (when configured)
    let sent = 0;
    let delivered = 0;
    let failed = 0;
    for (const cust of customers) {
      let personalized = campaign.body
        .replace(/\{business_name\}/g, cust.business_name || 'there')
        .replace(/\{contact_name\}/g, cust.contact_name || 'there');
      let status = 'sent';
      let providerId = null;
      let errorMsg = null;
      try {
        const result = await sendSms({ to: cust.phone, body: personalized });
        if (result.stub) {
          status = 'sent';
          providerId = null;
        } else {
          status = 'sent';
          providerId = result.providerId;
          delivered++;
        }
      } catch (e) {
        status = 'failed';
        failed++;
        errorMsg = e.message;
        console.error(`SMS to ${cust.phone} failed:`, e.message);
      }
      await client.query(
        `INSERT INTO sms_messages (campaign_id, customer_id, to_phone, body, status, provider_id, error, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [campaign.id, cust.id, cust.phone, personalized, status, providerId, errorMsg]
      );
      sent++;
    }

    await client.query(
      `UPDATE sms_campaigns
       SET status = 'sent', sent_at = NOW(),
           recipient_count = $2, sent_count = $2,
           delivered_count = $3, failed_count = $4
       WHERE id = $1`,
      [campaign.id, sent, delivered, failed]
    );

    await client.query('COMMIT');

    res.json({
      sent,
      delivered,
      failed,
      total: customers.length,
      stub: smsStub(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('send campaign:', err);
    res.status(500).json({ message: 'Failed to send campaign' });
  } finally {
    client.release();
  }
});

// DELETE /api/marketing/campaigns/:id — only drafts
router.delete('/campaigns/:id', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ deleted: true });
  try {
    const r = await pool.query(
      `DELETE FROM sms_campaigns WHERE id = $1 AND status IN ('draft', 'scheduled', 'failed') RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) {
      return res.status(400).json({ message: 'Cannot delete a sent campaign' });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('delete campaign:', err);
    res.status(500).json({ message: 'Failed to delete campaign' });
  }
});

// GET /api/marketing/stats — dashboard summary
router.get('/stats', requireRole('admin', 'manager'), async (req, res) => {
  if (DEMO_MODE) return res.json({ campaigns_total: 0, sent_total: 0, recipients_total: 0, last_30_days: 0 });
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) as campaigns_total,
        COALESCE(SUM(sent_count), 0) as sent_total,
        COALESCE(SUM(recipient_count), 0) as recipients_total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as last_30_days
      FROM sms_campaigns
      WHERE status IN ('sent', 'sending')
    `);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('marketing stats:', err);
    res.status(500).json({ message: 'Failed to load stats' });
  }
});

module.exports = router;