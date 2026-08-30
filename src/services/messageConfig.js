const axios = require('axios');
const config = require('../config');

/**
 * بيجيب نصوص رسايل البوت (طلب العنوان / السياسة / التأكيد والعرض) من إعدادات
 * بلاجين ووردبريس مباشرة — عشان يقدر يعدّلها من لوحة التحكم من غير ما يلمس كود.
 *
 * لو ووردبريس مش متاح دلوقتي، أو الحقل فاضي، أو حصل أي خطأ — بنرجّع null، والدالة
 * اللي بتنادي عليها في templates.js هي اللي بتقرر ترجع للنص الافتراضي المكتوب في الكود.
 * كده أي مشكلة في الاتصال بووردبريس ماتوقفش البوت عن الرد على العملاء خالص.
 */
async function fetchBotMessages() {
  const baseUrl = config.woocommerce.baseUrl;
  const secret = config.wpBotMessagesSecret;
  if (!baseUrl || !secret) return null;

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/wp-json/dolley/v1/bot-messages`;
    const res = await axios.get(url, { params: { secret }, timeout: 5000 });
    return res.data || null;
  } catch (err) {
    console.warn('⚠️ تعذّر جلب نصوص الرسائل من ووردبريس، هنستخدم النصوص الافتراضية:', err.message);
    return null;
  }
}

module.exports = { fetchBotMessages };
