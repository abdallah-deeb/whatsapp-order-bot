const express = require('express');
const config = require('../config');
const woocommerce = require('../services/woocommerce');
const whatsapp = require('../services/whatsapp');
const orderStore = require('../services/orderStore');
const templates = require('../services/templates');
const { verifyWooSignature } = require('../utils/verifyWooSignature');

const router = express.Router();

/**
 * WooCommerce webhook: "Order created" (أو "Order updated" لو عايز تستخدمه لحالات محددة زي on-hold).
 * لازم تعمل الـ webhook ده من WooCommerce > Settings > Advanced > Webhooks
 * وتحط رابط السيرفر ده + /webhooks/woocommerce/order-created
 */
router.post('/order-created', async (req, res) => {
  if (!verifyWooSignature(req)) {
    console.warn('🚫 Webhook signature غير صحيح — تم تجاهل الطلب');
    return res.status(401).json({ ok: false, error: 'invalid signature' });
  }

  const raw = req.body;
  if (!raw || !raw.id) {
    return res.status(400).json({ ok: false, error: 'invalid payload' });
  }

  const order = woocommerce.normalizeWooOrderPayload(raw);

  if (!order.customerPhone) {
    console.warn(`⚠️ الأوردر #${order.id} مفيهوش رقم موبايل — مش هنقدر نبعتله واتساب`);
    return res.status(200).json({ ok: true, skipped: 'no_phone' });
  }

  orderStore.saveOrder(order);

  // مش بنبعت أي حاجة أوتوماتيك هنا دلوقتي — العميل هو اللي بيبدأ المحادثة بنفسه
  // (زرار الواتساب في صفحة الشكر)، أو الموظفة تبعتها يدوي من زرار في لوحة التحكم
  // (endpoint /manual-send/:orderId تحت) لو العميل ماستخدمش زرار الموقع.
  console.log(
    `📦 أوردر جديد #${order.id} اتسجل — مستني العميل يبدأ المحادثة بنفسه، أو إرسال يدوي (رقم: ${order.customerPhone})`
  );

  return res.status(200).json({ ok: true, orderId: order.id });
});

/**
 * إرسال يدوي: بتستخدمها الموظفة (من زرار في صفحة الأوردرات بووردبريس) لأي أوردر
 * العميل فيه ما استخدمش زرار الواتساب في صفحة الشكر بنفسه.
 * بيبعت نفس قالب "order_confirmation" المعتمد، ويبدأ نفس محادثة البوت.
 *
 * لازم تبعتي السر في هيدر X-Manual-Send-Secret (لازم يتساوى مع MANUAL_SEND_SECRET في Render).
 */
router.post('/manual-send/:orderId', async (req, res) => {
  const expectedSecret = config.manualSendSecret;
  const providedSecret = req.headers['x-manual-send-secret'];
  if (!expectedSecret || providedSecret !== expectedSecret) {
    console.warn('🚫 محاولة إرسال يدوي بسر غير صحيح أو غير موجود');
    return res.status(401).json({ ok: false, error: 'invalid secret' });
  }

  const { orderId } = req.params;
  let order;
  try {
    order = await woocommerce.getOrder(orderId);
  } catch (err) {
    console.error(`❌ تعذّر جلب الأوردر #${orderId} من ووكومرس:`, err.message);
    return res.status(200).json({ ok: false, error: 'order_fetch_failed' });
  }

  if (!order.customerPhone) {
    return res.status(200).json({ ok: true, skipped: 'no_phone' });
  }

  orderStore.saveOrder(order);

  const templateParams = templates.buildOrderConfirmationTemplateParams(order);
  try {
    const result = await whatsapp.sendTemplateMessage(order.customerPhone, 'order_confirmation', templateParams);
    console.log(`✅ اتبعت إرسال يدوي لتأكيد الأوردر #${order.id} بنجاح عبر ${result.provider}`);
  } catch (err) {
    const details = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(`❌ فشل الإرسال اليدوي لتأكيد الأوردر #${order.id} لرقم ${order.customerPhone}:`, details);
    return res.status(200).json({ ok: false, error: 'send_failed' });
  }

  return res.status(200).json({ ok: true, orderId: order.id });
});

module.exports = router;
