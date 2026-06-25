const express = require('express');
const router = express.Router();
const { isStubMode } = require('../services/sms');

// GET /api/sms/status — for the UI to show whether Twilio is configured
router.get('/status', (req, res) => {
  res.json({
    stub: isStubMode(),
    from: process.env.TWILIO_FROM_NUMBER || null,
  });
});

module.exports = router;