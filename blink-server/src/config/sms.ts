import logger from '../utils/logger';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

export const isSmsConfigured =
  !!TWILIO_ACCOUNT_SID && !!TWILIO_AUTH_TOKEN && !!TWILIO_PHONE_NUMBER;

if (!isSmsConfigured) {
  logger.warn(
    'Twilio credentials not set. Falling back to dev-mode OTP (123456).'
  );
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!isSmsConfigured) {
    throw new Error('Twilio is not configured');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: TWILIO_PHONE_NUMBER!,
      Body: body,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error('Twilio SMS failed', { status: res.status, error: err });
    throw new Error(`Failed to send SMS: ${res.status}`);
  }

  logger.info('SMS sent', { to });
}
