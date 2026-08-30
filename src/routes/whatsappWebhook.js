const express = require('express');
const config = require('../config');
const conversationStore = require('../services/conversationStore');
const whatsapp = require('../services/whatsapp');
const templates = require('../services/templates');

const router = express.Router();

// النص الثابت اللي بلاجين "WhatsApp Order Confirmation Popup" بيحطه في أول رسالة
// (اللي العميلة بتبعتها لما تدوس زرار "تأكيد الطلب عبر واتساب" في صفحة الشكر) — بنستخدمه
// كعلامة مميزة عشان نتأكد إن الرسالة دي فعلاً جاية من الزرار ده، مش من أي حد بيكتب لنا
// عادي على نفس رقم الواتساب. شوفي wa_show_confirmation_popup() في whatsapp-order-confirmation.php.
const CONFIRMATION_MESSAGE_MARKER = 'أريد تأكيد طلبي رقم';

/**
 * القلب النابض للبوت: بييجي هنا أي رد من العميل (من أي مزود)، وبيتحرك حسب مرحلة
 * محادثته على واتساب (convo.state) — من غير أي حاجة مرتبطة برقم أوردر معيّن أو
 * تحديث على ووكومرس. البوت بس بيمشي في السكريبت المتفق عليه ويستنى رد العميل
 * في كل مرحلة:
 *
 * 0. مفيش محادثة متسجلة للرقم ده لسه، والرسالة مش رسالة تأكيد الأوردر الجاهزة من
 *    البلاجين (مفيهاش "أريد تأكيد طلبي رقم") → دي مش عميلة داخلة من زرار الشكر،
 *    ممكن تكون أي حد بيكتب على رقم الواتساب — البوت ماينفعش يرد عليها، بنتجاهلها.
 * 1. مفيش محادثة متسجلة للرقم ده لسه، والرسالة فيها العلامة المميزة دي → دي فعلاً
 *    عميلة داخلة من زرار الواتساب في صفحة الشكر — بنرد نطلب العنوان بالتفصيل ورقم
 *    تواصل إضافي، ونبدأ محادثة جديدة بحالة awaiting_address.
 * 2. awaiting_address → العميل بعت العنوان بالتفصيل — بنبعت سياسة الاستبدال/
 *    الاسترجاع والمعاينة، ونحول الحالة لـ awaiting_final_confirmation.
 * 3. awaiting_final_confirmation → أي رد من العميل هنا بنعتبره تأكيد (زي ما هو
 *    متفق عليه: "لو موافقة على كل حاجة ردي بكلمة تمام") — بنبعت رسالة التأكيد
 *    والعرض، ونحول الحالة لـ confirmed.
 * 4. confirmed (أو أي حاجة بعد كده) → رد بسيط بس، مفيش سكريبت تاني.
 */
async function handleIncomingReply({ fromPhone, text }) {
  let convo = conversationStore.getConversation(fromPhone);

  // أول رسالة من الرقم ده — منبدأش السكريبت غير لو الرسالة دي فعلاً رسالة تأكيد
  // الأوردر الجاهزة من زرار البلاجين. أي رسالة تانية من رقم جديد بنتجاهلها تمامًا.
  if (!convo) {
    if (!String(text || '').includes(CONFIRMATION_MESSAGE_MARKER)) {
      console.log(`ℹ️ رسالة من رقم ${fromPhone} مش رسالة تأكيد أوردر من زرار البلاجين، هنتجاهلها: "${text}"`);
      return;
    }
    convo = conversationStore.startConversation(fromPhone);
    console.log(`👋 محادثة جديدة (من زرار البلاجين) مع رقم ${fromPhone} — هنطلب العنوان.`);
    await whatsapp.sendMessage(fromPhone, await templates.buildAddressRequestMessage());
    return;
  }

  if (convo.state === 'awaiting_address') {
    convo.state = 'awaiting_final_confirmation';
    convo.addressText = text;
    conversationStore.saveConversation(convo);
    console.log(`📍 استلمنا العنوان من رقم ${fromPhone} — هنبعت السياسة.`);
    await whatsapp.sendMessage(fromPhone, await templates.buildPolicyMessage());
    return;
  }

  if (convo.state === 'awaiting_final_confirmation') {
    convo.state = 'confirmed';
    conversationStore.saveConversation(convo);
    console.log(`✅ رقم ${fromPhone} أكّد — هنبعت رسالة التأكيد والعرض.`);
    await whatsapp.sendMessage(fromPhone, await templates.buildConfirmationOfferMessage());
    return;
  }

  // بعد التأكيد، أي رسالة تانية بترجع رد بسيط بس — مفيش سكريبت تاني بعد كده.
  await whatsapp.sendMessage(
    fromPhone,
    'تمام، وصلتنا رسالتك ❤️ حد من فريقنا هيتابع معاك لو محتاجة أي حاجة تانية.'
  );
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
