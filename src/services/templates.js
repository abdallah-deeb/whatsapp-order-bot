/**
 * قوالب الرسائل بالعربي (لهجة مصرية بسيطة وواضحة).
 *
 * ملحوظة: أول رسالة بتتبعت للعميل (Business-Initiated) في واتساب لازم تكون
 * "Template Message" متعمّدة وموافق عليها من Meta مسبقًا لو بتستخدم Meta Cloud API
 * في الإنتاج. النص هنا هو المحتوى المقترح لهذا القالب.
 */

function formatCurrency(amount, currency = 'EGP') {
  const num = Number(amount || 0);
  return `${num.toFixed(2)} ${currency}`;
}

function buildOrderConfirmationMessage(order) {
  const itemsText = order.items
    .map((item) => `• ${item.name} × ${item.quantity}`)
    .join('\n');

  return [
    `أهلاً ${order.customerName} 👋`,
    `استلمنا طلبك رقم #${order.id} وعايزين نتأكد من البيانات قبل ما نبدأ نجهزه:`,
    '',
    itemsText,
    '',
    `الإجمالي: ${formatCurrency(order.total, order.currency)}`,
    `طريقة الدفع: ${order.paymentMethod}`,
    `العنوان: ${order.shippingAddress}`,
    `رقم التواصل: ${order.customerPhoneDisplay || order.customerPhone}`,
    '',
    'لو البيانات دي صح، رد بكلمة "تمام" أو "أيوه" وهنبدأ نجهز طلبك على طول.',
    'لو في حاجة غلط (العنوان، الرقم، أو حتى عايز تلغي الأوردر)، اكتبها لنا وهنظبطها.',
  ].join('\n');
}

function buildOrderConfirmedReply(order) {
  return `تمام يا ${order.customerName}! ✅ تم تأكيد طلبك رقم #${order.id} وهيتجهز حالًا. هنبعتلك تحديث لما يطلع للشحن.`;
}

function buildOrderCancelledReply(order) {
  return `تم إلغاء طلبك رقم #${order.id} حسب طلبك. لو غيّرت رأيك أو حبيت تطلب تاني، احنا موجودين. 🙏`;
}

function buildEditAcknowledgedReply(order, note) {
  return [
    `تمام، سجّلنا التعديل ده على طلبك رقم #${order.id}:`,
    `"${note}"`,
    'حد من فريقنا هيراجعه ويأكده معاك خلال شوية.',
  ].join('\n');
}

function buildUnclearReply(order) {
  return `آسفين، مفهمناش قصدك بالظبط 🙏 ممكن تأكد لنا طلبك رقم #${order.id} بكلمة "تمام"، أو تقولنا التعديل اللي عايزه بالظبط؟`;
}

/**
 * رسالة اقتراح Upsell/Cross-sell بعد ما العميل يأكد الأوردر.
 * suggestion ده كائن اختياري { name, reason } لو الـ AI قدر يقترح حاجة مناسبة،
 * أو ممكن يكون فاضي لو مفيش اقتراح مناسب دلوقتي.
 */
function buildUpsellMessage(order, suggestion) {
  if (!suggestion) return null;
  return [
    `بالمناسبة يا ${order.customerName} 🙌`,
    `عملاء كتير اشتروا "${suggestion.name}" مع طلبهم${suggestion.reason ? ` — ${suggestion.reason}` : ''}.`,
    'حابب نضيفهولك على نفس الأوردر؟ رد بـ "ضيفه" لو عايز، أو سيبها كده لو مش محتاجه دلوقتي.',
  ].join('\n');
}

module.exports = {
  buildOrderConfirmationMessage,
  buildOrderConfirmedReply,
  buildOrderCancelledReply,
  buildEditAcknowledgedReply,
  buildUnclearReply,
  buildUpsellMessage,
};
