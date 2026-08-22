const express = require('express');
const config = require('../config');
const orderStore = require('../services/orderStore');
const woocommerce = require('../services/woocommerce');
const whatsapp = require('../services/whatsapp');
const ai = require('../services/ai');
const templates = require('../services/templates');

const router = express.Router();

/**
 * القلب النابض للبوت: بييجي هنا أي رد من العميل (من أي مزود)،
 * بيتفهم بالـ AI، وبيحدّث الأوردر ويرد على العميل.
 */
async function handleIncomingReply({ fromPhone, text }) {
  const order = orderStore.findPendingOrderByPhone(fromPhone);

  if (!order) {
    console.log(`ℹ️ رسالة من رقم ${fromPhone} مش مرتبطة بأي أوردر معروف: "${text}"`);
    await whatsapp.sendMessage(
      fromPhone,
      'أهلاً بيك 👋 مش لاقيين أوردر مرتبط بالرقم ده حاليًا. لو عندك استفسار، فريقنا هيتواصل معاك.'
    );
    return;
  }

  const interpretation = await ai.interpretCustomerReply({ order, message: text });

  switch (interpretation.intent) {
    case 'confirm': {
      order.state = 'confirmed';
      orderStore.saveOrder(order);
      await woocommerce.updateOrderStatus(order.id, 'processing');
      await whatsapp.sendMessage(fromPhone, templates.buildOrderConfirmedReply(order));

      const suggestion = ai.suggestCrossSell(order);
      const upsellMsg = templates.buildUpsellMessage(order, suggestion);
      if (upsellMsg) {
        await whatsapp.sendMessage(fromPhone, upsellMsg);
      }
      break;
    }

    case 'cancel': {
      order.state = 'cancelled';
      orderStore.saveOrder(order);
      await woocommerce.updateOrderStatus(order.id, 'cancelled');
      await whatsapp.sendMessage(fromPhone, templates.buildOrderCancelledReply(order));
      break;
    }

    case 'edit': {
      order.state = 'edit_requested';
      orderStore.saveOrder(order);
      const noteText = interpretation.note || text;

      if (interpretation.correctedAddress) {
        await woocommerce.updateOrderShippingAddress(order.id, interpretation.correctedAddress);
        order.shippingAddress = interpretation.correctedAddress;
        orderStore.saveOrder(order);
      }
      // بنسيب الملاحظة على الأوردر عشان موظف يراجعها ويأكدها بشريًا — أمان أكتر من كون الـ AI يقرر لوحده في حاجات حساسة
      await woocommerce.addOrderNote(order.id, `طلب تعديل من العميل عبر واتساب: ${noteText}`);

      const reply = interpretation.suggestedReply || templates.buildEditAcknowledgedReply(order, noteText);
      await whatsapp.sendMessage(fromPhone, reply);
      break;
    }

    case 'unclear':
    default: {
      const reply = interpretation.suggestedReply || templates.buildUnclearReply(order);
      await whatsapp.sendMessage(fromPhone, reply);
      break;
    }
  }
}

/**
 * Endpoint داخلي بسيط بيشتغل في أي وضع (مفيد جدًا مع scripts/simulate.js)
 * لمحاكاة وصول رد من العميل من غير ما نحتاج نربط Twilio/Meta فعليًا.
 */
router.post('/test-incoming', async (req, res) => {
  const { from, text } = req.body || {};
  if (!from || !text) {
    return res.status(400).json({ ok: false, error: 'from and text are required' });
  }
  try {
    await handleIncomingReply({ fromPhone: from, text });
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ خطأ أثناء معالجة رد العميل (test-incoming):', err.message);
    res.status(200).json({ ok: false, error: 'processing_failed' });
  }
});

/**
 * Webhook استقبال ردود Twilio (بيبعت application/x-www-form-urlencoded)
 * حطه في Twilio Console كـ "WHEN A MESSAGE COMES IN"
 */
router.post('/twilio', async (req, res) => {
  const from = (req.body.From || '').replace('whatsapp:', '');
  const text = req.body.Body || '';
  if (from && text) {
    try {
      await handleIncomingReply({ fromPhone: from, text });
    } catch (err) {
      console.error('❌ خطأ في معالجة رد Twilio:', err.message);
    }
  }
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>'); // نرجع رد فاضي، إحنا بنبعت الردود بنفسنا عبر sendMessage
});

/**
 * Webhook استقبال ردود Meta Cloud API.
 * الـ GET بيُستخدم مرة واحدة وقت ما بتربط الـ Webhook على Meta Developer Console (Verification).
 */
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/meta', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const messages = change?.value?.messages;

    if (messages && messages.length > 0) {
      for (const msg of messages) {
        if (msg.type === 'text') {
          await handleIncomingReply({ fromPhone: msg.from, text: msg.text.body });
        }
      }
    }
  } catch (err) {
    console.error('❌ خطأ في معالجة webhook Meta:', err.message);
  }
  res.sendStatus(200);
});

module.exports = { router, handleIncomingReply };
