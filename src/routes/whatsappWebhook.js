const express = require('express');
const config = require('../config');
const conversationStore = require('../services/conversationStore');
const whatsapp = require('../services/whatsapp');
const templates = require('../services/templates');
const woocommerce = require('../services/woocommerce');

const router = express.Router();

// النص الثابت اللي بلاجين "WhatsApp Order Confirmation Popup" بيحطه في أول رسالة
// (اللي العميلة بتبعتها لما تدوس زرار "تأكيد الطلب عبر واتساب" في صفحة الشكر) — بنستخدمه
// كعلامة مميزة عشان نتأكد إن الرسالة دي فعلاً جاية من الزرار ده، مش من أي حد بيكتب لنا
// عادي على نفس رقم الواتساب. شوفي wa_show_confirmation_popup() في whatsapp-order-confirmation.php.
const CONFIRMATION_MESSAGE_MARKER = 'أريد تأكيد طلبي رقم';

// الرسالة الموحّدة اللي بتتبعت في أي حالة العميل يخرج فيها عن السكريبت المتوقع
// (رد غريب، سؤال، رفض يبعت بيانات...) — بدل ما البوت يحاول "يفهم" أو يكرر
// الطلب، بيسلّم المحادثة فورًا لفريق خدمة العملاء (اللي بيردوا من تطبيق واتساب
// بيزنس نفسه) وبيقف تمامًا عن أي تدخل تاني في المحادثة دي.
const HANDOFF_MESSAGE = 'تمام، هحول محادثتك لفريق خدمة العملاء وهيكملوا معاكِ حالًا 🙏';

/**
 * بيتأكد إن الرد اللي وصل في مرحلة طلب العنوان فيه فعلاً بيانات عنوان حقيقي —
 * مش مجرد دوسة على زرار "تأكيد البيانات"، ومش رد قصير زي "تمام"، ومش جملة
 * زي "أنا باعت العنوان مظبوط" (طويلة بس مفيهاش تفاصيل عنوان فعلي). عشان كده
 * بنشترط طول معقول *وكمان* وجود رقم واحد على الأقل (شارع/عمارة/شقة دايمًا
 * بيبقى فيها أرقام) — أي رد مايستوفيش الشرطين بيتحول لخدمة العملاء على طول.
 */
function looksLikeRealAddress(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (trimmed === 'تأكيد البيانات') return false; // نص الزرار نفسه لوحده، مش عنوان حقيقي
  const hasDigit = /\d/.test(trimmed);
  return trimmed.length >= 15 && hasDigit;
}

/**
 * بيتأكد إن الرد اللي وصل بعد رسالة السياسة فعلاً بيقصد "موافقة" (كتابة أو
 * دوسة زرار "موافق")، مش أي رد عشوائي — عشان محدش يعدي المرحلة دي من غير ما
 * يوافق فعليًا على السياسة.
 */
function looksLikeConfirmation(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  // لو الرد فيه كلمة نفي ("مش تمام"، "لأ") مايتحسبش موافقة حتى لو فيه
  // كلمة موافقة جواه — عشان نفضل في الجانب الآمن (تسليم لخدمة العملاء)
  // بدل ما نفهم رد غلط على إنه موافقة.
  const negationWords = ['مش', 'لأ', 'مو ', 'رافض', 'معترض'];
  if (negationWords.some((w) => normalized.includes(w))) return false;
  const confirmWords = ['موافق', 'تمام', 'ايوه', 'أيوه', 'اه', 'آه', 'ok', 'okay', 'yes'];
  return confirmWords.some((w) => normalized.includes(w));
}

/**
 * بيطلع رقم الأوردر من نص رسالة العلامة المميزة نفسها (اللي بلاجين ووردبريس
 * بيحطه فيها: "أريد تأكيد طلبي رقم: 12345") — مش بندور عليه في ووكومرس ولا
 * بنعتمد عليه في أي حاجة أثناء المحادثة، بس بنحتفظ بيه عشان نقدر نحدّث حالة
 * الأوردر ده بالتحديد في اللحظة اللي العميلة تأكد فيها إنها عايزة طلبها زي ما هو.
 */
function extractOrderIdFromMarkerMessage(text) {
  const match = String(text || '').match(/أريد تأكيد طلبي رقم:?\s*#?(\d+)/);
  return match ? match[1] : null;
}

/**
 * القلب النابض للبوت: بييجي هنا أي رد من العميل (من أي مزود)، وبيتحرك حسب مرحلة
 * محادثته على واتساب (convo.state). البوت بيمشي في سكريبت بسيط وصارم: أي رد
 * مش واضح أو خارج عن المتوقع في أي مرحلة (ما عدا المرحلة الأخيرة) → البوت بيوقف
 * فورًا ويسلّم المحادثة لفريق خدمة العملاء (state = handed_off)، ومايتدخلش تاني
 * خالص في المحادثة دي — الفريق بيكمل بنفسه من تطبيق واتساب بيزنس مباشرة.
 * مفيش أي حاجة عن الأوردر بتتحدث على ووكومرس إلا في حالة واحدة بس: لما العميلة
 * تأكد إنها عايزة طلبها زي ما هو في آخر خطوة.
 *
 * 0. مفيش محادثة متسجلة للرقم ده لسه، والرسالة مش رسالة تأكيد الأوردر الجاهزة من
 *    البلاجين (مفيهاش "أريد تأكيد طلبي رقم") → دي مش عميلة داخلة من زرار الشكر،
 *    ممكن تكون أي حد بيكتب على رقم الواتساب — البوت ماينفعش يرد عليها، بنتجاهلها.
 * 1. مفيش محادثة متسجلة للرقم ده لسه، والرسالة فيها العلامة المميزة دي → دي فعلاً
 *    عميلة داخلة من زرار الواتساب في صفحة الشكر — بنطلع رقم الأوردر من نص الرسالة
 *    نفسها (لو موجود)، ونرد نطلب العنوان بالتفصيل (مع زرار "تأكيد البيانات")،
 *    ونبدأ محادثة جديدة بحالة awaiting_address.
 * 2. awaiting_address → لازم عنوان حقيقي (طول كافي + فيه رقم). أي رد تاني (رفض،
 *    "أنا باعت العنوان مظبوط"، سؤال...) → تسليم فوري لخدمة العملاء (handed_off).
 *    لما يوصل عنوان فعلي، بنبعت السياسة (مع زرار "موافق")، ونحول الحالة
 *    لـ awaiting_final_confirmation.
 * 3. awaiting_final_confirmation → لازم موافقة واضحة ("موافق"/"تمام"...، أو
 *    دوسة الزرار). أي رد تاني (سؤال عن السياسة، رفض...) → تسليم فوري لخدمة
 *    العملاء (handed_off). لما توصل الموافقة، بنبعت رسالة التأكيد والعرض (مع
 *    زرارين: "هختار العرض" / "لا هأكد طلبي بس")، ونحول الحالة لـ confirmed.
 * 4. confirmed → آخر مرحلة، مبتوقفش وتستنى صيغة معينة: لو اختارت "هختار العرض"
 *    → تسليم لخدمة العملاء يساعدوها تضيف المنتج (handed_off). أي رد تاني → عايزة
 *    طلبها زي ما هو: تأكيد نهائي + تحديث حالة الأوردر على ووكومرس لـ "تم
 *    التفعيل بواسطة البوت"، وتقفل المحادثة (closed).
 * 5. handed_off → البوت بيتوقف تمامًا، مايردش خالص — الفريق هو اللي بيكمل من
 *    تطبيق واتساب بيزنس مباشرة.
 * 6. closed (أو أي حاجة بعد كده) → رد بسيط بس، مفيش سكريبت تاني.
 *
 * ⚠️ مهم: التخزين ده بالرقم بس (مش بالأوردر)، فلو نفس الرقم عمل أوردر جديد بعد
 * ما محادثته الأولى وصلت لـ handed_off أو closed، لازم البوت يبدأ معاه من
 * الأول تاني على الأوردر الجديد — مش يفضل ساكت لأبد الأبد لمجرد إن أوردر
 * قديم خالص اتحول لخدمة العملاء. عشان كده أي رسالة فيها العلامة المميزة
 * (يعني جاية فعلاً من زرار الواتساب في صفحة الشكر) بتبدأ محادثة جديدة من
 * الصفر لو رقم الأوردر مختلف عن اللي كان متسجل قبل كده، أو لو المحادثة
 * القديمة كانت خلصت أصلاً (handed_off/closed) — حتى لو نفس رقم الأوردر.
 */
async function handleIncomingReply({ fromPhone, text }) {
  const messageText = String(text || '');
  const isMarkerMessage = messageText.includes(CONFIRMATION_MESSAGE_MARKER);
  let convo = conversationStore.getConversation(fromPhone);

  if (isMarkerMessage) {
    const newOrderId = extractOrderIdFromMarkerMessage(messageText);
    const isDifferentOrder = !convo || convo.orderId !== newOrderId;
    const oldConversationIsDone = convo && (convo.state === 'handed_off' || convo.state === 'closed');

    if (isDifferentOrder || oldConversationIsDone) {
      convo = conversationStore.startConversation(fromPhone);
      convo.orderId = newOrderId;
      conversationStore.saveConversation(convo);
      console.log(
        `👋 محادثة جديدة (من زرار البلاجين) مع رقم ${fromPhone}${convo.orderId ? ` — أوردر #${convo.orderId}` : ' — مقدرناش نلاقي رقم الأوردر في الرسالة'} — هنطلب العنوان.`
      );
      await whatsapp.sendButtonMessage(fromPhone, await templates.buildAddressRequestMessage(), ['تأكيد البيانات']);
      return;
    }
    // نفس الأوردر ولسه المحادثة شغالة (مش متسلمة ولا مقفولة) — على الأغلب
    // دوسة تانية بالغلط على نفس زرار الواتساب، بنسيبها تكمل عادي من غير ما
    // نبدأ من الأول تاني (السطر اللي جاي تحت هيكمل يعالجها حسب مرحلتها الحالية).
  }

  // أول رسالة من الرقم ده (ومفيهاش العلامة المميزة) — دي مش عميلة داخلة من
  // زرار الشكر، ممكن تكون أي حد بيكتب على رقم الواتساب — بنتجاهلها.
  if (!convo) {
    console.log(`ℹ️ رسالة من رقم ${fromPhone} مش رسالة تأكيد أوردر من زرار البلاجين، هنتجاهلها: "${messageText}"`);
    return;
  }

  if (convo.state === 'awaiting_address') {
    if (!looksLikeRealAddress(text)) {
      convo.state = 'handed_off';
      conversationStore.saveConversation(convo);
      console.log(`⚠️ رقم ${fromPhone} خرج عن السكريبت في مرحلة العنوان (رد: "${text}") — تسليم فوري لخدمة العملاء.`);
      await whatsapp.sendMessage(fromPhone, HANDOFF_MESSAGE);
      return;
    }

    convo.state = 'awaiting_final_confirmation';
    convo.addressText = text;
    conversationStore.saveConversation(convo);
    console.log(`📍 استلمنا العنوان من رقم ${fromPhone} — هنبعت السياسة.`);
    await whatsapp.sendButtonMessage(fromPhone, await templates.buildPolicyMessage(), ['موافق']);
    return;
  }

  if (convo.state === 'awaiting_final_confirmation') {
    if (!looksLikeConfirmation(text)) {
      convo.state = 'handed_off';
      conversationStore.saveConversation(convo);
      console.log(`⚠️ رقم ${fromPhone} خرج عن السكريبت في مرحلة السياسة (رد: "${text}") — تسليم فوري لخدمة العملاء.`);
      await whatsapp.sendMessage(fromPhone, HANDOFF_MESSAGE);
      return;
    }

    convo.state = 'confirmed';
    conversationStore.saveConversation(convo);
    console.log(`✅ رقم ${fromPhone} أكّد — هنبعت رسالة التأكيد والعرض.`);
    await whatsapp.sendButtonMessage(fromPhone, await templates.buildConfirmationOfferMessage(), [
      'هختار العرض',
      'لا هأكد طلبي بس',
    ]);
    return;
  }

  // آخر مرحلة في السكريبت — عكس المراحل اللي فاتت، هنا مش بنستنى صيغة رد معينة:
  // أي رد غير "هختار العرض" بالتحديد بنعتبره العميلة عايزة طلبها زي ما هو.
  if (convo.state === 'confirmed') {
    const normalized = String(text || '').trim();
    const choseOffer = normalized.includes('هختار العرض') || normalized.includes('اختار العرض');

    if (choseOffer) {
      convo.state = 'handed_off';
      conversationStore.saveConversation(convo);
      console.log(`🛍️ رقم ${fromPhone} اختار يستخدم العرض — تسليم فوري لخدمة العملاء يساعدوها تضيف المنتج.`);
      await whatsapp.sendMessage(fromPhone, HANDOFF_MESSAGE);
      return;
    }

    // أي رد تاني (زي "لا هأكد طلبي بس" أو أي حاجة تانية) = عايزة طلبها زي ما هو.
    convo.state = 'closed';
    conversationStore.saveConversation(convo);
    console.log(`✅ رقم ${fromPhone} عايز طلبه زي ما هو — هنأكد وهنحدث حالة الأوردر.`);
    await whatsapp.sendMessage(
      fromPhone,
      'تمام، طلبك مؤكد نهائيًا ❤️ هيتجهز ويتشحن لحضرتك قريب. شكرًا لثقتك في Dolley Store 🌷'
    );

    if (convo.orderId) {
      try {
        await woocommerce.updateOrderStatus(convo.orderId, 'bot-confirmed');
        console.log(`✅ أوردر #${convo.orderId} اتحدثت حالته لـ "تم التفعيل بواسطة البوت".`);
      } catch (err) {
        console.error(`❌ فشل تحديث حالة الأوردر #${convo.orderId} لـ "تم التفعيل بواسطة البوت":`, err.message);
      }
    } else {
      console.warn(`⚠️ مقدرناش نحدد رقم الأوردر لرقم ${fromPhone} من رسالة البداية — مش هينفع نحدث حالته على ووكومرس.`);
    }
    return;
  }

  // اتسلّمت لخدمة العملاء بالفعل — البوت بيتوقف تمامًا ومايردش خالص، عشان
  // مايتعارضش مع رد الموظفة اللي هتكمل المحادثة بنفسها من التطبيق.
  if (convo.state === 'handed_off') {
    console.log(`🤝 رقم ${fromPhone} في محادثة متسلّمة لخدمة العملاء بالفعل — البوت مش هيرد.`);
    return;
  }

  // بعد إقفال المحادثة (closed)، أي رسالة تانية بترجع رد بسيط بس.
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
    const { text, waId, type, interactiveButtonReply, buttonReply } = req.body || {};
    let replyText = null;

    if (type === 'text' && text) {
      replyText = text;
    } else if (type === 'button') {
      // شكل الـ payload بالظبط لرد الزرار مش موثّق بالكامل من واتي رسميًا، فبندور
      // في أكتر من مكان محتمل. لو مقدرناش نلاقي النص، بنسجل الـ payload كامل في
      // اللوج عشان نشوف شكله الحقيقي ونظبط الكود على أساسه أول ما نشوف مثال حقيقي.
      const buttonData = interactiveButtonReply || buttonReply || req.body.button || null;
      replyText = (buttonData && (buttonData.text || buttonData.title || buttonData.payload)) || null;
      if (!replyText) {
        console.warn('⚠️ استلمنا رد زرار من واتي بس مقدرناش نلاقي نص الزرار جواه — الـ payload كامل:', JSON.stringify(req.body));
      }
    }

    if (waId && replyText) {
      await handleIncomingReply({ fromPhone: waId, text: replyText });
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
