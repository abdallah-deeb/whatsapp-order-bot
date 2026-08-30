const express = require('express');
const config = require('../config');
const orderStore = require('../services/orderStore');
const woocommerce = require('../services/woocommerce');
const whatsapp = require('../services/whatsapp');
const ai = require('../services/ai');
const templates = require('../services/templates');

const router = express.Router();

/**
 * القلب النابض للبوت: بييجي هنا أي رد من العميل (من أي مزود)، وبيتحرك حسب مرحلة
 * محادثة الأوردر (order.state):
 *
 * 1. awaiting_confirmation → دي أول رسالة بتوصلنا من العميل (هو اللي بدأ المحادثة،
 *    من زرار الواتساب في صفحة الشكر أو بعد إرسال يدوي من لوحة التحكم) — بنرد نطلب
 *    العنوان بالتفصيل ورقم تواصل إضافي، ونحول الحالة لـ awaiting_address.
 * 2. awaiting_address → العميل بعت العنوان بالتفصيل — بنسجله كملاحظة على الأوردر،
 *    وبنبعت سياسة الاستبدال/الاسترجاع والمعاينة، ونحول الحالة لـ awaiting_final_confirmation.
 * 3. awaiting_final_confirmation (أو أي حالة تانية) → زي الشغل الأصلي: بنفهم رد العميل
 *    بالـ AI (تأكيد/إلغاء/تعديل) ونتصرف على أساسه.
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

  if (order.state === 'awaiting_confirmation') {
    order.state = 'awaiting_address';
    orderStore.saveOrder(order);
    await whatsapp.sendMessage(fromPhone, await templates.buildAddressRequestMessage());
    return;
  }

  if (order.state === 'awaiting_address') {
    order.state = 'awaiting_final_confirmation';
    orderStore.saveOrder(order);
    // بنسجل العنوان بالتفصيل ورقم التواصل الإضافي كملاحظة على الأوردر — الموظفة تراجعها
    // وتوزّعها على حقول الشحن (زي ما بلاجين "Dolley Order Ops" بيتيح لها أصلًا).
    await woocommerce.addOrderNote(order.id, `العنوان بالتفصيل ورقم التواصل الإضافي من العميل عبر واتساب:\n${text}`);
    await whatsapp.sendMessage(fromPhone, await templates.buildPolicyMessage());
    return;
  }

  const interpretation = await ai.interpretCustomerReply({ order, message: text });

  switch (interpretation.intent) {
    case 'confirm': {
      order.state = 'confirmed';
      orderStore.saveOrder(order);
      await woocommerce.updateOrderStatus(order.id, 'processing');
      await whatsapp.sendMessage(fromPhone, await templates.buildConfirmationOfferMessage());
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
 * Webhook استقبال ردود Wati (بتاع BYOA - Bring Your Own AI Agent).
 * حطه في Wati > Connect Custom AI Agents > Add Webhook، Event = "Assigned Message Received"
 */
router.post('/wati', async (req, res) => {
  try {
    const { text, waId, type } = req.body || {};
    if (waId && text && type === 'text') {
      await handleIncomingReply({ fromPhone: waId, text });
    }
  } catch (err) {
    console.error('❌ خطأ في معالجة رد Wati:', err.message);
  }
  res.sendStatus(200);
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
