const axios = require('axios');
const config = require('../config');

// في وضع mock، بنخزن كل رسالة "متبعتة" هنا عشان نقدر نتابعها في اللوج أو في سكريبت المحاكاة
const outbox = [];

async function sendViaMock(to, text) {
  const entry = { to, text, sentAt: new Date().toISOString() };
  outbox.push(entry);
  console.log('\n📤 [MOCK WHATSAPP] رسالة صادرة إلى', to);
  console.log('----------------------------------------');
  console.log(text);
  console.log('----------------------------------------\n');
  return { ok: true, provider: 'mock' };
}

async function sendViaTwilio(to, text) {
  const { accountSid, authToken, from } = config.twilio;
  if (!accountSid || !authToken) {
    throw new Error('Twilio غير مُعد: لازم TWILIO_ACCOUNT_SID و TWILIO_AUTH_TOKEN في .env');
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:${to.startsWith('+') ? to : `+${to}`}`,
    Body: text,
  });
  const res = await axios.post(url, body, {
    auth: { username: accountSid, password: authToken },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return { ok: true, provider: 'twilio', sid: res.data.sid };
}

async function sendViaMeta(to, text) {
  const { token, phoneNumberId } = config.meta;
  if (!token || !phoneNumberId) {
    throw new Error('Meta Cloud API غير مُعد: لازم META_WHATSAPP_TOKEN و META_PHONE_NUMBER_ID في .env');
  }
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const res = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      type: 'text',
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return { ok: true, provider: 'meta', messageId: res.data?.messages?.[0]?.id };
}

/**
 * نقطة الدخول الموحدة لإرسال رسالة واتساب — بتختار المزود حسب WHATSAPP_PROVIDER.
 * @param {string} to - رقم موبايل العميل (بصيغة دولية، مثال: 201001234567)
 * @param {string} text - نص الرسالة
 */
async function sendMessage(to, text) {
  switch (config.whatsappProvider) {
    case 'twilio':
      return sendViaTwilio(to, text);
    case 'meta':
      return sendViaMeta(to, text);
    case 'mock':
    default:
      return sendViaMock(to, text);
  }
}

module.exports = { sendMessage, outbox };
