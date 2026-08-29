const express = require('express');
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

  console.log(
    `📦 أوردر جديد #${order.id} — هنبعت تأكيد واتساب لرقم ${order.customerPhone} (زي ما اتسجل: ${order.customerPhoneDisplay})`
  );

  const message = templates.buildOrderConfirmationMessage(order);
  try {
    const result = await whatsapp.sendMessage(order.customerPhone, message);
    console.log(`✅ اتبعتت رسالة تأكيد الأوردر #${order.id} بنجاح عبر ${result.provider}`);
  } catch (err) {
    const details = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(`❌ فشل إرسال رسالة تأكيد الأوردر #${order.id} لرقم ${order.customerPhone}:`, details);
    return res.status(200).json({ ok: false, error: 'send_failed' });
  }

  return res.status(200).json({ ok: true, orderId: order.id });
});

module.exports = router;
