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

async function sendViaWati(to, text) {
  const { apiEndpoint, accessToken } = config.wati;
  if (!apiEndpoint || !accessToken) {
    throw new Error('Wati غير مُعد: لازم WATI_API_ENDPOINT و WATI_ACCESS_TOKEN في .env');
  }
  const phone = to.replace(/^\+/, '');
  const url = `${apiEndpoint}/api/v1/sendSessionMessage/${phone}`;
  const res = await axios.post(url, null, {
    params: { messageText: text },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { ok: true, provider: 'wati', data: res.data };
}

/**
 * بيبعت رسالة "قالب" (Template) معتمدة من ميتا مسبقًا — ده الشكل الوحيد المسموح
 * بيه لأول رسالة بتتبعت لعميل جديد لسه ما كلمناهوش على واتساب (Business-Initiated).
 * لازم القالب يكون معمول ومتوافق عليه في واتي (Campaigns > Template Messages) الأول.
 *
 * @param {string} to - رقم العميل بالصيغة الدولية
 * @param {string} templateName - اسم القالب بالظبط زي ما هو مسجل في واتي (مثال: order_confirmation)
 * @param {Array<{name: string, value: string}>} parameters - قيم المتغيرات بترتيبها ({{1}}, {{2}}, ...)
 */
async function sendViaWatiTemplate(to, templateName, parameters) {
  const { apiEndpoint, accessToken } = config.wati;
  if (!apiEndpoint || !accessToken) {
    throw new Error('Wati غير مُعد: لازم WATI_API_ENDPOINT و WATI_ACCESS_TOKEN في .env');
  }
  const phone = to.replace(/^\+/, '');
  const url = `${apiEndpoint}/api/v1/sendTemplateMessage`;
  const res = await axios.post(
    url,
    {
      template_name: templateName,
      broadcast_name: templateName,
      parameters,
    },
    {
      params: { whatsappNumber: phone },
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    }
  );
  return { ok: true, provider: 'wati-template', data: res.data };
}

/**
 * نقطة الدخول الموحدة لإرسال رسالة "قالب" — دلوقتي مفعّلة لواتي بس (المزود الوحيد الشغال فعليًا).
 */
async function sendTemplateMessage(to, templateName, parameters) {
  if (config.whatsappProvider === 'wati') {
    return sendViaWatiTemplate(to, templateName, parameters);
  }
  return sendViaMock(to, `[قالب: ${templateName}] ${JSON.stringify(parameters)}`);
}

/**
 * بيبعت رسالة "session" عادية (نفس شروط sendMessage) لكن مع أزرار رد سريعة تحتها
 * (لحد 3 أزرار، كل زرار نصه أقصى حاجة 20 حرف تقريبًا — قيود واتساب نفسه).
 * لو العميل داس على زرار، بيوصلنا ردّه بنفس شكل أي رسالة نصية عادية (شايفينه في
 * أول if جوه /wati تحت — بندور على نص الزرار في أكتر من مكان محتمل في الـ payload
 * لأن واتي مش موثقة توثيق كامل لشكله بالظبط).
 *
 * لو العميل كتب رد عادي بدل ما يدوس زرار، البوت برضه بيستقبله ويكمل عادي —
 * الأزرار دي بس تسهيل شكلي، مش بتلغي إمكانية الكتابة اليدوية.
 */
async function sendViaWatiButtons(to, body, buttons, { header, footer } = {}) {
  const { apiEndpoint, accessToken } = config.wati;
  if (!apiEndpoint || !accessToken) {
    throw new Error('Wati غير مُعد: لازم WATI_API_ENDPOINT و WATI_ACCESS_TOKEN في .env');
  }
  const phone = to.replace(/^\+/, '');
  const url = `${apiEndpoint}/api/v1/sendInteractiveButtonsMessage`;
  const payload = {
    body,
    buttons: buttons.map((text) => ({ text })),
  };
  if (header) payload.header = { type: 'Text', text: header };
  if (footer) payload.footer = footer;

  const res = await axios.post(url, payload, {
    params: { whatsappNumber: phone },
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return { ok: true, provider: 'wati-buttons', data: res.data };
}

/**
 * نقطة الدخول الموحدة لإرسال رسالة بأزرار — دلوقتي مفعّلة لواتي بس.
 * في أي وضع تاني (mock مثلاً) بنكتفي بإضافة أسامي الأزرار في آخر النص، عشان
 * التجربة المحلية تفضل شغالة من غير ما تحتاج حساب واتي فعلي.
 */
async function sendButtonMessage(to, body, buttons) {
  if (config.whatsappProvider === 'wati') {
    return sendViaWatiButtons(to, body, buttons);
  }
  const hint = buttons && buttons.length ? `\n\n(${buttons.join(' / ')})` : '';
  return sendViaMock(to, `${body}${hint}`);
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
    case 'wati':
      return sendViaWati(to, text);
    case 'mock':
    default:
      return sendViaMock(to, text);
  }
}

module.exports = { sendMessage, sendTemplateMessage, sendButtonMessage, outbox };
