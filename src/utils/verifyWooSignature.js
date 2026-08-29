const crypto = require('crypto');
const config = require('../config');

/**
 * WooCommerce بيوقّع كل webhook بـ HMAC-SHA256 (base64) في هيدر X-WC-Webhook-Signature،
 * باستخدام الـ secret اللي انت حاططه وقت إنشاء الـ webhook.
 * التحقق ده مهم عشان محدش يقدر يبعتلنا "أوردرات وهمية" مباشرة على الـ endpoint.
 */
function verifyWooSignature(req) {
  const secret = config.woocommerce.webhookSecret;
  if (!secret) {
    // لو لسه مفيش secret متسجل (وضع تجريبي)، منعديش التحقق
    return true;
  }
  const signatureHeader = req.headers['x-wc-webhook-signature'];
  if (!signatureHeader || !req.rawBody) return false;

  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');

  let match = false;
  try {
    match = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch (err) {
    console.warn('⚠️ تعذّر مقارنة التوقيعين (طول مختلف على الأرجح):', err.message);
  }

  if (!match) {
    // تشخيص مؤقت: بيوريني في اللوج التوقيعين عشان نلاقي سبب الاختلاف بالظبط.
    // مش بيطبع الـ body كامل ولا الـ secret نفسه، بس التوقيعين وطولهم.
    console.warn('🔎 [DEBUG] توقيع WooCommerce المستلم:', signatureHeader);
    console.warn('🔎 [DEBUG] التوقيع المتوقع من السيرفر:', expected);
    console.warn('🔎 [DEBUG] طول الـ rawBody بالبايت:', req.rawBody ? req.rawBody.length : 'undefined');
    console.warn('🔎 [DEBUG] Content-Type المستلم:', req.headers['content-type']);
  }

  return match;
}

module.exports = { verifyWooSignature };
