/**
 * تخزين مؤقت (in-memory) لحالة محادثة الواتساب مع كل رقم — من غير أي ربط بأوردر
 * معيّن أو أي تحديث على ووكومرس. الهدف بس إننا نعرف كل رقم واصل لمرحلة إيه في
 * السكريبت (طلب العنوان → السياسة → التأكيد والعرض) عشان نرد عليه بالرسالة الصح.
 *
 * ⚠️ زي orderStore.js بالظبط، ده تخزين في الذاكرة بس — بيتصفر لو السيرفر عمل
 * restart. ده مقبول هنا لأن أسوأ حاجة ممكن تحصل إن محادثة نصها بتبدأ من الأول
 * (يعني تاني رسالة من العميل تتفهم على إنها "أول رسالة")، مش إنها ترفض العميل خالص.
 */

const conversationsByPhone = new Map();

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '').replace(/^0+/, '');
}

function getConversation(phone) {
  const normalized = normalizePhone(phone);
  return conversationsByPhone.get(normalized) || null;
}

function startConversation(phone) {
  const normalized = normalizePhone(phone);
  const convo = {
    phone: normalized,
    state: 'awaiting_address',
    startedAt: new Date().toISOString(),
  };
  conversationsByPhone.set(normalized, convo);
  return convo;
}

function saveConversation(convo) {
  conversationsByPhone.set(convo.phone, convo);
  return convo;
}

module.exports = {
  getConversation,
  startConversation,
  saveConversation,
  normalizePhone,
};
