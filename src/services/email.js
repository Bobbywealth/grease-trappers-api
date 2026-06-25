// Email sender — Resend when configured, stub mode otherwise.
//
// Env vars to enable:
//   RESEND_API_KEY       re_xxxxxxxxxxxx
//   EMAIL_FROM           "The Grease Trappers <service@greasetrapers.com>"  (must be a verified sender)
//
// In stub mode, returns ok:true with stub:true. The reset link is logged
// to the API console so admins can grab it for the user manually.

import { log } from 'console';

let resendClient = null;

function getClient() {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    // eslint-disable-next-line global-require
    const { Resend } = require('resend');
    resendClient = new Resend(key);
    console.log('[email] Resend client initialized');
    return resendClient;
  } catch (err) {
    console.warn('[email] resend package not installed — running in stub mode');
    return null;
  }
}

export function isStubMode() {
  return !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM;
}

export async function sendEmail({ to, subject, html, text }) {
  const client = getClient();
  const from = process.env.EMAIL_FROM || 'noreply@greasetrapers.com';
  if (!client) {
    console.log('[email STUB] would send:', { to, subject });
    return { ok: true, stub: true, providerId: null, to, subject };
  }
  const result = await client.emails.send({ from, to, subject, html, text });
  return { ok: true, stub: false, providerId: result.data?.id, to, subject };
}