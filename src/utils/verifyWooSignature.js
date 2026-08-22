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
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

module.exports = { verifyWooSignature };
