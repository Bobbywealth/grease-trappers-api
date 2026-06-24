/**
 * src/routes/dashboard.js — Stats for the manager dashboard
 */

const express = require('express');
const { pool, DEMO_MODE } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  if (DEMO_MODE) {
    return res.json({
      totals: { customers: 0, traps: 0, jobs_scheduled_today: 0, jobs_completed_this_week: 0, active_contracts: 0, employees_active_now: 0, revenue_this_month: 0, overdue_invoices: 0 },
      recent_jobs: [],
      jobs_by_status: [],
    });
  }
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM customers WHERE is_active = TRUE) as customers,
        (SELECT COUNT(*) FROM traps) as traps,
        (SELECT COUNT(*) FROM jobs WHERE scheduled_date = CURRENT_DATE AND status = 'scheduled') as jobs_scheduled_today,
        (SELECT COUNT(*) FROM jobs WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '7 days') as jobs_completed_this_week,
        (SELECT COUNT(*) FROM service_contracts WHERE is_active = TRUE) as active_contracts,
        (SELECT COUNT(*) FROM time_clock WHERE clock_out_at IS NULL) as employees_active_now,
        (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status = 'paid' AND issue_date >= DATE_TRUNC('month', NOW())) as revenue_this_month,
        (SELECT COUNT(*) FROM invoices WHERE status IN ('sent','overdue') AND due_date < CURRENT_DATE) as overdue_invoices
    `);

    const recent = await pool.query(`
      SELECT j.id, j.scheduled_date, j.scheduled_time, j.status, c.business_name
      FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
      ORDER BY j.created_at DESC LIMIT 10
    `);

    const byStatus = await pool.query(`
      SELECT status, COUNT(*) as count FROM jobs GROUP BY status
    `);

    res.json({
      totals: totals.rows[0],
      recent_jobs: recent.rows,
      jobs_by_status: byStatus.rows,
    });
  } catch (err) {
    console.error('dashboard stats:', err);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/employee-stats/:id — for the field app home screen
router.get('/employee-stats', async (req, res) => {
  if (DEMO_MODE) {
    return res.json({ jobs_today: 0, jobs_completed_this_week: 0, hours_this_week: 0, current_shift: null });
  }
  try {
    const today = await pool.query(
      `SELECT COUNT(*) as count FROM jobs WHERE scheduled_date = CURRENT_DATE
        AND (assigned_to = $1 OR id IN (SELECT job_id FROM job_crew WHERE user_id = $1))`,
      [req.user.id]
    );
    const week = await pool.query(
      `SELECT COUNT(*) as count FROM jobs WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '7 days'
        AND (assigned_to = $1 OR id IN (SELECT job_id FROM job_crew WHERE user_id = $1))`,
      [req.user.id]
    );
    const hours = await pool.query(
      `SELECT COALESCE(SUM(total_hours), 0) as total FROM time_clock WHERE user_id = $1 AND clock_in_at >= NOW() - INTERVAL '7 days'`,
      [req.user.id]
    );
    const shift = await pool.query(
      'SELECT * FROM time_clock WHERE user_id = $1 AND clock_out_at IS NULL LIMIT 1',
      [req.user.id]
    );
    res.json({
      jobs_today: parseInt(today.rows[0].count, 10),
      jobs_completed_this_week: parseInt(week.rows[0].count, 10),
      hours_this_week: parseFloat(hours.rows[0].total),
      current_shift: shift.rows[0] || null,
    });
  } catch (err) {
    console.error('employee stats:', err);
    res.status(500).json({ message: 'Failed' });
  }
});

module.exports = router;