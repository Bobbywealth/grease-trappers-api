const express = require('express');
const router = express.Router();
const { isStubMode } = require('../services/email');

// GET /api/email/status — for the UI to show whether Resend is configured
router.get('/status', (req, res) => {
  res.json({
    stub: isStubMode(),
    from: process.env.EMAIL_FROM || null,
  });
});

module.exports = router;