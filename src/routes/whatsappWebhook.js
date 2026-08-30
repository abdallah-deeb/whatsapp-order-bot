const express = require('express');
const config = require('../config');
const conversationStore = require('../services/conversationStore');
const whatsapp = require('../services/whatsapp');
const templates = require('../services/templates');
const woocommerce = require('../services/woocommerce');
const ai = require('../services/ai');

const router = express.Router();

// النص الثابت اللي بلاجين "WhatsApp Order Confirmation Popup" بيحطه في أول رسالة
// (اللي العميلة بتبعتها لما تدوس زرار "تأكيد الطلب عبر واتساب" في صفحة الشكر) — بنستخدمه
// كعلامة مميزة عشان نتأكد إن الرسالة دي فعلاً جاية من الزرار ده، مش من أي حد بيكتب لنا
// عادي على نفس رقم الواتساب. شوفي wa_show_confirmation_popup() في whatsapp-order-confirmation.php.
const CONFIRMATION_MESSAGE_MARKER = 'أريد تأكيد طلبي رقم';

// نصوص الأزرار — ثابتة في مكان واحد عشان تتغيّر بسهولة، ومستخدمة في أكتر من مكان
// (إرسال الزرار نفسه + التعرف على دوسته حتى لو وصلت كنص عادي).
//
// ⚠️ زرار "هضيف تفاصيل عنواني": طلبتي "هضيف تفاصيل علي عنواني" بالظبط، لكن
// واتساب بيحدد أقصى طول لنص الزرار بـ 20 حرف (طلبك كان 22 حرف) — لو بعتناه زي
// ما هو ممكن الرسالة كلها ترفض من واتساب. عشان كده اختصرته لأقرب صيغة بنفس
// المعنى ("هضيف تفاصيل عنواني" — 18 حرف) بدل ما أخاطر إن الرسالة توصلش خالص.
const ADDRESS_WILL_TYPE_BUTTON_LABEL = 'هضيف تفاصيل عنواني';
// زرار تاني في نفس رسالة طلب العنوان — للعميلة اللي شايفة إن العنوان المسجل
// على الأوردر أصلاً مظبوط ومش محتاجة تضيف تفاصيل زيادة. بندّيها لخدمة العملاء
// على طول عشان تراجع العنوان المسجل يدويًا (البوت مالوش رؤية على بيانات
// الأوردر نفسه، فمش هينفع "يتأكد" من عنوان قديم بنفسه).
const ADDRESS_ALREADY_FINE_BUTTON_LABEL = 'كده تمام';
const POLICY_BUTTON_LABEL = 'تمام';
const OFFER_BUTTON_LABEL = 'هختار العرض';
const NO_OFFER_BUTTON_LABEL = 'لا هأكد طلبي بس';

// علامة مميزة بنحط بيها لوكيشن واتساب لما العميلة تبعته بدل ما تكتب العنوان —
// بنحوّله لنص فيه رابط جوجل ماps، وبيتقبل كعنوان صحيح تلقائيًا (لوكيشن حقيقي
// أدق من أي وصف نصي، ومفيدة جدًا للعميلة اللي مش عارفة توصف عنوانها).
const LOCATION_ADDRESS_MARKER = '📍 لوكيشن واتساب:';

function formatLocationAsAddressText(latitude, longitude) {
  return `${LOCATION_ADDRESS_MARKER} https://www.google.com/maps?q=${latitude},${longitude}`;
}

// الرسالة الموحّدة اللي بتتبعت في أي حالة العميل يخرج فيها عن السكريبت المتوقع
// (رد غريب، سؤال، رفض يبعت بيانات...) — بدل ما البوت يحاول "يفهم" أو يكرر
// الطلب، بيسلّم المحادثة فورًا لفريق خدمة العملاء (اللي بيردوا من تطبيق واتساب
// بيزنس نفسه) وبيقف تمامًا عن أي تدخل تاني في المحادثة دي.
const HANDOFF_MESSAGE = 'تمام، هحول محادثتك لفريق خدمة العملاء وهيكملوا معاكِ حالًا 🙏';

// الرسالة اللي بتتبعت لو العميلة اختارت "هختار العرض" — بتفضل بعدها في حالة
// handed_off زي أي تحويل تاني (البوت بيسكت والفريق بيكمل معاها من واتساب
// بيزنس مباشرة عشان يضيفوا المنتج)، بس النص هنا مخصوص لتذكيرها بالعرض والوقت.
const OFFER_CHOSEN_MESSAGE = 'أنا في انتظارك 🌸 العرض متاح لمدة 15 دقيقة بس.';

// الرسالة اللي بتتبعت لو العميلة اختارت تأكيد طلبها زي ما هو (من غير العرض).
const ORDER_CONFIRMED_SHORT_MESSAGE = 'تم تأكيد طلبك بنجاح ✅ شكرًا لثقتك في Dolley Store 🌷';

// لما العميلة تدوس "هضيف تفاصيل عنواني"، البوت ماينفعش يعتبر الدوسة دي نفسها
// "رد مش واضح" ويسلّم على طول — لازم يستنى فعليًا لحد ما تكتب العنوان. بنبعتلها
// رسالة استنى، ولو مبعتتش حاجة خلال دقيقة، بنفكّرها مرة واحدة بس.
const ADDRESS_WAITING_MESSAGE = 'تمام، أنا في انتظارك 🌸';
const ADDRESS_REMINDER_MESSAGE = 'لسه مستنينك تبعتيلي العنوان بالتفصيل 📍 فين العنوان؟';
const ADDRESS_REMINDER_DELAY_MS = 60 * 1000; // دقيقة واحدة

// تايمرات التذكير دي في الذاكرة بس (زي كل حاجة تانية في المشروع ده) — بتتصفر
// لو السيرفر عمل restart، وده مقبول: أسوأ حاجة ممكن تحصل إن العميلة ماتوصلهاش
// رسالة التذكير، مش إن حاجة تتكسر.
const addressReminderTimers = new Map(); // phone -> Timeout handle

function clearAddressReminder(phone) {
  const existing = addressReminderTimers.get(phone);
  if (existing) {
    clearTimeout(existing);
    addressReminderTimers.delete(phone);
  }
}

function scheduleAddressReminder(phone) {
  clearAddressReminder(phone);
  const timer = setTimeout(async () => {
    addressReminderTimers.delete(phone);
    // نتأكد إن المحادثة لسه في نفس المرحلة قبل ما نبعت التذكير — لو العميلة
    // بعتت العنوان أو خرجت عن السكريبت في الدقيقة دي، التذكير مبقاش له لازمة.
    const latestConvo = conversationStore.getConversation(phone);
    if (latestConvo && latestConvo.state === 'awaiting_address') {
      console.log(`⏰ مرّت دقيقة من غير ما رقم ${phone} يبعت العنوان — هنبعتله تذكير.`);
      try {
        await whatsapp.sendMessage(phone, ADDRESS_REMINDER_MESSAGE);
      } catch (err) {
        console.error(`❌ فشل إرسال تذكير العنوان لرقم ${phone}:`, err.message);
      }
    }
  }, ADDRESS_REMINDER_DELAY_MS);
  addressReminderTimers.set(phone, timer);
}

// كلمات بتدل على وصف عنوان مصري حقيقي حتى لو من غير رقم عمارة (عنوان مبني على
// علامات مميزة بدل رقم — بيحصل أحيانًا). دي خطة بديلة بسيطة (من غير AI) —
// مش هتكون دقيقة زي فهم المعنى الفعلي، لكنها أفضل من الاعتماد على رقم بس.
const ADDRESS_DESCRIPTIVE_KEYWORDS = [
  'شارع', 'عماره', 'عمارة', 'شقه', 'شقة', 'دور', 'منطقه', 'منطقة', 'ميدان',
  'كوبري', 'كباري', 'جسر', 'بجوار', 'جنب', 'قدام', 'أمام', 'امام', 'خلف', 'ورا',
  'مدخل', 'محافظه', 'محافظة', 'مركز', 'قريه', 'قرية', 'عزبه', 'عزبة', 'برج',
  'كمبوند', 'فيلا', 'محطه', 'محطة', 'طريق', 'مساكن', 'حي ', 'نجع', 'ازبه',
];

/**
 * بيتأكد إن الرد اللي وصل في مرحلة طلب العنوان فيه فعلاً بيانات عنوان حقيقي —
 * مش مجرد دوسة على زرار، ومش رد قصير زي "تمام"، ومش جملة زي "أنا باعت العنوان
 * مظبوط" (طويلة بس مفيهاش تفاصيل عنوان فعلي). دي خطة بديلة بتشتغل لما الـ AI
 * (classifyAddressWithAI) مش متاح — بنقبل الرد في حالتين:
 * 1. فيه رقم واحد على الأقل (شارع/عمارة/شقة دايمًا بيبقى فيها أرقام) وطوله
 *    كفاية — ده أقوى إشارة.
 * 2. من غير رقم، بس طويل بما يكفي وفيه كلمة وصفية معروفة (بجوار، خلف، ميدان...)
 *    — عشان نقبل عنوان مبني على علامة مميزة بدل رقم عمارة.
 * أي رد مايستوفيش أي شرط من دول بيتحول لخدمة العملاء على طول.
 */
function looksLikeRealAddress(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (trimmed === ADDRESS_WILL_TYPE_BUTTON_LABEL || trimmed === ADDRESS_ALREADY_FINE_BUTTON_LABEL) return false;

  const hasDigit = /\d/.test(trimmed);
  if (hasDigit && trimmed.length >= 10) return true;

  const hasAddressKeyword = ADDRESS_DESCRIPTIVE_KEYWORDS.some((w) => trimmed.includes(w));
  if (hasAddressKeyword && trimmed.length >= 20) return true;

  return false;
}

/**
 * بتقرر هل الرد ده "عنوان حقيقي" ولا لأ — وده بيحصل على 3 مستويات بالترتيب:
 * 1. لو لوكيشن واتساب فعلي (اللي البوت نفسه حوّله لنص فيه العلامة المميزة) →
 *    مقبول تلقائيًا، لوكيشن حقيقي أدق من أي وصف.
 * 2. غير كده، بنسأل الـ AI (لو متاح) يحكم هل ده وصف عنوان حقيقي كافي ولا لأ —
 *    ده أدق من مجرد "فيه رقم وطول كافي" لأنه بيفهم المعنى مش بس الشكل.
 * 3. لو الـ AI مش متاح (مفيش مفتاح Anthropic في الإعدادات) أو حصل خطأ/تأخير،
 *    بنرجع لطريقة الطول+الرقم البسيطة (looksLikeRealAddress) بدل ما البوت يقف.
 */
async function isRealAddress(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith(LOCATION_ADDRESS_MARKER)) return true;

  const aiVerdict = await ai.classifyAddressWithAI(trimmed);
  if (aiVerdict !== null) return aiVerdict;

  return looksLikeRealAddress(trimmed);
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
 *    نفسها (لو موجود)، ونرد نطلب العنوان بالتفصيل (مع زرارين: "هضيف تفاصيل
 *    عنواني" / "كده تمام")، ونبدأ محادثة جديدة بحالة awaiting_address.
 * 2. awaiting_address → لازم عنوان حقيقي (طول كافي + فيه رقم). دوسة "كده تمام"
 *    → تسليم فوري لخدمة العملاء يراجعوا العنوان المسجل يدويًا. دوسة "هضيف
 *    تفاصيل عنواني" → مش تسليم، البوت بيستنى فعليًا ويفكّرها مرة واحدة لو
 *    مرت دقيقة من غير رد. أي رد تاني مش عنوان حقيقي (رفض، "أنا باعت العنوان
 *    مظبوط"، سؤال...) → تسليم فوري لخدمة العملاء (handed_off). لما يوصل عنوان
 *    فعلي، بنبعت السياسة (مع زرار "تمام")، ونحول الحالة لـ awaiting_final_confirmation.
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
      clearAddressReminder(fromPhone); // لغي أي تذكير قديم متبقي من أوردر سابق لنفس الرقم
      convo = conversationStore.startConversation(fromPhone);
      convo.orderId = newOrderId;
      conversationStore.saveConversation(convo);
      console.log(
        `👋 محادثة جديدة (من زرار البلاجين) مع رقم ${fromPhone}${convo.orderId ? ` — أوردر #${convo.orderId}` : ' — مقدرناش نلاقي رقم الأوردر في الرسالة'} — هنطلب العنوان.`
      );
      await whatsapp.sendButtonMessage(fromPhone, await templates.buildAddressRequestMessage(), [
        ADDRESS_WILL_TYPE_BUTTON_LABEL,
        ADDRESS_ALREADY_FINE_BUTTON_LABEL,
      ]);
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
    const trimmedReply = String(text || '').trim();

    // "كده تمام" = العنوان المسجل على الأوردر أصلاً مظبوط وملهاش داعي تضيف تفاصيل —
    // البوت مالوش رؤية على الأوردر نفسه عشان يتأكد بنفسه، فبيسلّم لخدمة العملاء
    // يراجعوا العنوان المسجل يدويًا.
    if (trimmedReply === ADDRESS_ALREADY_FINE_BUTTON_LABEL) {
      clearAddressReminder(fromPhone);
      convo.state = 'handed_off';
      conversationStore.saveConversation(convo);
      console.log(`📦 رقم ${fromPhone} قال إن العنوان المسجل مظبوط زي ما هو — تسليم لخدمة العملاء يراجعوه يدويًا.`);
      await whatsapp.sendMessage(fromPhone, HANDOFF_MESSAGE);
      return;
    }

    // "هضيف تفاصيل عنواني" = العميلة هتكتب العنوان دلوقتي — ده مش رد خارج عن
    // السكريبت، ده بالظبط المتوقع منها. مايتسلّمش لخدمة العملاء؛ البوت بيستنى
    // فعليًا، وبيفكّرها مرة واحدة لو مرت دقيقة من غير ما تبعت حاجة.
    if (trimmedReply === ADDRESS_WILL_TYPE_BUTTON_LABEL) {
      console.log(`⏳ رقم ${fromPhone} هيبعت العنوان دلوقتي — هنستناه ونفكّره لو اتأخر.`);
      await whatsapp.sendMessage(fromPhone, ADDRESS_WAITING_MESSAGE);
      scheduleAddressReminder(fromPhone);
      return;
    }

    if (!(await isRealAddress(text))) {
      clearAddressReminder(fromPhone);
      convo.state = 'handed_off';
      conversationStore.saveConversation(convo);
      console.log(`⚠️ رقم ${fromPhone} خرج عن السكريبت في مرحلة العنوان (رد: "${text}") — تسليم فوري لخدمة العملاء.`);
      await whatsapp.sendMessage(fromPhone, HANDOFF_MESSAGE);
      return;
    }

    clearAddressReminder(fromPhone);
    convo.state = 'awaiting_final_confirmation';
    convo.addressText = text;
    conversationStore.saveConversation(convo);
    console.log(`📍 استلمنا العنوان من رقم ${fromPhone} — هنبعت السياسة.`);
    await whatsapp.sendButtonMessage(fromPhone, await templates.buildPolicyMessage(), [POLICY_BUTTON_LABEL]);
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
      OFFER_BUTTON_LABEL,
      NO_OFFER_BUTTON_LABEL,
    ]);
    return;
  }

  // آخر مرحلة في السكريبت — عكس المراحل اللي فاتت، هنا مش بنستنى صيغة رد معينة:
  // أي رد غير "هختار العرض" بالتحديد بنعتبره العميلة عايزة طلبها زي ما هو.
  if (convo.state === 'confirmed') {
    const normalized = String(text || '').trim();
    const choseOffer = normalized.includes(OFFER_BUTTON_LABEL) || normalized.includes('اختار العرض');

    if (choseOffer) {
      convo.state = 'handed_off';
      conversationStore.saveConversation(convo);
      console.log(`🛍️ رقم ${fromPhone} اختار يستخدم العرض — تسليم فوري لخدمة العملاء يساعدوها تضيف المنتج.`);
      await whatsapp.sendMessage(fromPhone, OFFER_CHOSEN_MESSAGE);
      return;
    }

    // أي رد تاني (زي "لا هأكد طلبي بس" أو أي حاجة تانية) = عايزة طلبها زي ما هو.
    convo.state = 'closed';
    conversationStore.saveConversation(convo);
    console.log(`✅ رقم ${fromPhone} عايز طلبه زي ما هو — هنأكد وهنحدث حالة الأوردر.`);
    await whatsapp.sendMessage(fromPhone, ORDER_CONFIRMED_SHORT_MESSAGE);

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
  // Twilio بيبعت اللوكيشن كإحداثيات مباشرة في الحقول دي بدل نص عادي.
  let text = req.body.Body || '';
  if (!text && req.body.Latitude && req.body.Longitude) {
    text = formatLocationAsAddressText(req.body.Latitude, req.body.Longitude);
  }
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

// أسامي الأزرار المعروفة اللي البوت نفسه بيبعتها — بنستخدمها كخطة بديلة لو
// شكل الـ payload بتاع دوسة الزرار من واتي مختلف عن اللي متوقعينه (مش موثّق
// رسميًا من واتي، فبندور على أي حتة في الـ payload فيها نص زرار معروف).
const KNOWN_BUTTON_LABELS = [
  ADDRESS_WILL_TYPE_BUTTON_LABEL,
  ADDRESS_ALREADY_FINE_BUTTON_LABEL,
  POLICY_BUTTON_LABEL,
  OFFER_BUTTON_LABEL,
  NO_OFFER_BUTTON_LABEL,
];

/**
 * بتدور جوه أي object/array (شكل الـ payload) عن أول قيمة نصية بتطابق واحد من
 * أسامي الأزرار المعروفة بالظبط — مهما كان اسم الحقل اللي هي متخبية جواه.
 */
function findKnownButtonLabel(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') {
    return KNOWN_BUTTON_LABELS.includes(value.trim()) ? value.trim() : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKnownButtonLabel(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = findKnownButtonLabel(value[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * بتدور جوه أي object/array (شكل الـ payload) عن أول حتة فيها إحداثيات لوكيشن
 * (latitude/longitude أو lat/lng) — مهما كان اسم الحقل اللي هي متخبية جواه،
 * بالظبط زي findKnownButtonLabel لكن للوكيشن بدل نص الزرار.
 */
function findLocationInPayload(value, depth = 0) {
  if (depth > 6 || value == null || typeof value !== 'object') return null;
  if (!Array.isArray(value)) {
    const latitude = typeof value.latitude === 'number' ? value.latitude : value.lat;
    const longitude = typeof value.longitude === 'number' ? value.longitude : (value.lng ?? value.long);
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      return { latitude, longitude };
    }
  }
  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const item of entries) {
    const found = findLocationInPayload(item, depth + 1);
    if (found) return found;
  }
  return null;
}

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
    } else {
      const location = findLocationInPayload(req.body);

      if (location) {
        replyText = formatLocationAsAddressText(location.latitude, location.longitude);
        console.log(`📍 [Wati] استلمنا لوكيشن من رقم ${waId}: ${location.latitude}, ${location.longitude}`);
      } else {
        // مش رسالة نصية ولا لوكيشن — يبقى على الأغلب دوسة زرار (أو شكل تاني من
        // واتي مش متعامل معاه لسه). شكل الـ payload بالظبط لرد الزرار مش موثّق
        // من واتي رسميًا، فبندور الأول في أكتر الأماكن المحتملة، وبعدين كخطة
        // أخيرة بندور في الـ payload كله عن أي نص بيطابق واحد من أسامي الأزرار.
        const buttonData = interactiveButtonReply || buttonReply || req.body.button || null;
        replyText =
          (buttonData && (buttonData.text || buttonData.title || buttonData.payload)) ||
          findKnownButtonLabel(req.body) ||
          null;
      }

      // بنسجل الـ payload كامل دايمًا في الحالة دي (لقينا رد أو لأ) — عشان لو
      // فيه شكل تالت لسه مش متعامل معاه، نقدر نشوفه في اللوج ونضيفه.
      console.log(
        `🔎 [Wati] رسالة مش نوعها "text" وصلت (type: ${type}) — النص اللي لقيناه: ${replyText ? `"${replyText}"` : 'مفيش'} — الـ payload كامل:`,
        JSON.stringify(req.body)
      );
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
