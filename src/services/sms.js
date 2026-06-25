// SMS sender — Twilio when configured, stub mode otherwise.
//
// Env vars to enable real sending:
//   TWILIO_ACCOUNT_SID   e.g. ACxxxxxxxxxxxxxxxxxxxx
//   TWILIO_AUTH_TOKEN    your auth token
//   TWILIO_FROM_NUMBER   e.g. +18626223485  (must be a Twilio-owned number)
//
// In stub mode, send() resolves successfully and records the message
// in the DB. UI shows "Stub Mode" badge in Settings until env vars
// are set on Render.

let twilioClient = null;

function getClient() {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    // Lazy require so the dep isn't loaded unless needed
    // (keeps boot fast + works without twilio installed in stub mode)
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    twilioClient = twilio(sid, token);
    console.log('[sms] Twilio client initialized');
    return twilioClient;
  } catch (err) {
    console.warn('[sms] twilio package not installed — running in stub mode');
    return null;
  }
}

export function isStubMode() {
  return !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER;
}

export async function sendSms({ to, body }) {
  const client = getClient();
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!client || !from) {
    return {
      ok: true,
      stub: true,
      providerId: null,
      to,
      body,
    };
  }
  const msg = await client.messages.create({ from, to, body });
  return {
    ok: true,
    stub: false,
    providerId: msg.sid,
    to,
    body,
  };
}