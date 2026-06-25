// Forgot password + reset password flow.
//
// POST /api/auth/forgot
//   body: { email }
//   Always returns 200 (so attackers can't enumerate users).
//   In real mode (RESEND_API_KEY set): emails the user a reset link.
//   In stub mode (no email configured): returns the link in the response
//   so admins can copy it during development.
//
// POST /api/auth/forgot/reset
//   body: { token, password }
//   Consumes a reset token and updates the user's password.

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { pool, DEMO_MODE } = require('../config/db');
const { sendEmail, isStubMode } = require('../services/email');

const TOKEN_TTL_HOURS = 1;
const FRONTEND_BASE = process.env.FRONTEND_BASE || 'https://grease-trappers-web-v2.onrender.com';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// POST /api/auth/forgot
router.post('/', async (req, res) => {
  const { email } = req.body || {};
  const genericResponse = { ok: true, message: 'If that email exists, a reset link has been sent.' };

  if (DEMO_MODE) return res.json(genericResponse);
  if (!email) return res.json(genericResponse);

  try {
    const userRes = await pool.query(
      `SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE`,
      [email]
    );
    const user = userRes.rows[0];
    if (!user) {
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expires, req.ip]
    );

    const resetUrl = FRONTEND_BASE + '/reset-password?token=' + rawToken;
    const ttlLabel = TOKEN_TTL_HOURS === 1 ? 'hour' : 'hours';

    if (isStubMode()) {
      console.log('[forgot STUB] reset URL for ' + user.email + ': ' + resetUrl);
      return res.json({
        ok: true,
        message: 'Reset link generated (stub mode).',
        stub: true,
        reset_url: resetUrl,
      });
    }

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0F172A">Reset your password</h2>
        <p>Hi ${user.name.split(' ')[0]},</p>
        <p>Click the button below to set a new password for your Grease Trappers account.</p>
        <p style="margin:32px 0">
          <a href="${resetUrl}" style="background:#2563EB;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Reset password
          </a>
        </p>
        <p style="color:#64748B;font-size:13px">This link expires in ${TOKEN_TTL_HOURS} ${ttlLabel}. If you didn't request this, ignore this email.</p>
      </div>
    `;
    await sendEmail({
      to: user.email,
      subject: 'Reset your Grease Trappers password',
      html,
      text: 'Reset your password: ' + resetUrl,
    });

    res.json(genericResponse);
  } catch (err) {
    console.error('forgot password:', err);
    res.json(genericResponse);
  }
});

// POST /api/auth/forgot/reset
router.post('/reset', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ message: 'token and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  if (DEMO_MODE) return res.json({ ok: true });

  try {
    const tokenHash = hashToken(token);
    const r = await pool.query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );
    const row = r.rows[0];
    if (!row) return res.status(400).json({ message: 'Invalid or expired link' });
    if (row.used_at) return res.status(400).json({ message: 'This link has already been used' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ message: 'This link has expired' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hash, row.user_id]);
    await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('reset password:', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

module.exports = router;
