require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  whatsappProvider: (process.env.WHATSAPP_PROVIDER || 'mock').toLowerCase(),

  // سر بسيط بيحمي endpoint الإرسال اليدوي (/webhooks/woocommerce/manual-send/:orderId)
  // عشان محدش يقدر يستخدمه غير زرار لوحة التحكم بتاعتنا. اختاري أي نص عشوائي طويل.
  manualSendSecret: process.env.MANUAL_SEND_SECRET || '',

  // سر بيسمح للبوت يجيب نصوص الرسايل (طلب العنوان / السياسة / التأكيد والعرض) من
  // إعدادات بلاجين ووردبريس مباشرة — عشان تقدر تعدّليها من لوحة التحكم من غير كود.
  // لازم يتساوى مع الحقل "سر رسائل البوت" في صفحة إعدادات البلاجين.
  wpBotMessagesSecret: process.env.WP_BOT_MESSAGES_SECRET || '',

  woocommerce: {
    baseUrl: process.env.WOOCOMMERCE_BASE_URL || '',
    consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || '',
    consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
    webhookSecret: process.env.WOOCOMMERCE_WEBHOOK_SECRET || '',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
  },

  meta: {
    token: process.env.META_WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    verifyToken: process.env.META_VERIFY_TOKEN || '',
  },

  wati: {
    // مثال: https://live-mt-server.wati.io/12345 (لاقيه في Wati > API Docs)
    apiEndpoint: (process.env.WATI_API_ENDPOINT || '').replace(/\/$/, ''),
    accessToken: process.env.WATI_ACCESS_TOKEN || '',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
  },
};

module.exports = config;
