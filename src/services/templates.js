/**
 * قوالب الرسائل بالعربي (لهجة مصرية بسيطة وواضحة).
 *
 * ملحوظة: أول رسالة بتتبعت للعميل (Business-Initiated) في واتساب لازم تكون
 * "Template Message" متعمّدة وموافق عليها من Meta مسبقًا لو بتستخدم Meta Cloud API
 * في الإنتاج. النص هنا هو المحتوى المقترح لهذا القالب.
 */

const messageConfig = require('./messageConfig');

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

/**
 * بيبني قايمة المتغيرات لقالب واتساب المعتمد "order_confirmation" —
 * لازم يكون بنفس ترتيب المتغيرات بالظبط زي ما اتعمل في واتي:
 * {{1}} = اسم العميل، {{2}} = رقم الأوردر، {{3}} = الإجمالي، {{4}} = العنوان.
 */
function buildOrderConfirmationTemplateParams(order) {
  return [
    { name: '1', value: order.customerName },
    { name: '2', value: String(order.id) },
    { name: '3', value: formatCurrency(order.total, order.currency) },
    { name: '4', value: order.shippingAddress },
  ];
}

function buildOrderConfirmedReply(order) {
  return `تمام يا ${order.customerName}! ✅ تم تأكيد طلبك رقم #${order.id} وهيتجهز حالًا. هنبعتلك تحديث لما يطلع للشحن.`;
}

/**
 * أول رسالة بيبعتها البوت لما العميل يبدأ المحادثة بنفسه (من زرار الواتساب في صفحة الشكر،
 * أو من الإرسال اليدوي من لوحة التحكم) — بنطلب منه العنوان بالتفصيل ورقم تواصل إضافي.
 *
 * ⚠️ async: بتحاول تجيب النص من إعدادات بلاجين ووردبريس الأول (عشان تقدري تعدّليه من
 * لوحة التحكم من غير كود)، ولو مش متاح أو فاضي بترجع للنص الافتراضي هنا في الكود.
 */
async function buildAddressRequestMessage() {
  const remote = await messageConfig.fetchBotMessages();
  if (remote && remote.address_request_message) return remote.address_request_message;

  return [
    'أهلاً بحضرتك 👋',
    'معاك مريم من Customer Service - Dolley Store ❤️',
    'بخصوص الأوردر الخاص بحضرتك، برجاء تأكيد الأوردر وإرسال العنوان بالتفصيل عشان نقدر نجهزه للشحن 📦',
    '📍 العنوان:',
    '* رقم الشارع',
    '* رقم العمارة',
    '* رقم الشقة / الدور',
    '* علامة مميزة قريبة',
    '* رقم إضافي للتواصل',
    '',
    'لو مش عارفة تكتبي العنوان بالتفصيل، تقدري كمان تبعتيلنا اللوكيشن بتاعك مباشرة من واتساب 📍 (زرار المشبك 📎 ثم Location)',
    '',
    'ابعتلنا البيانات هنا، وهنقوم بتأكيد الأوردر مع حضرتك قبل الشحن ❤️',
    'شكراً لثقتك في Dolley Store 🌷',
  ].join('\n');
}

/**
 * سياسة الاستبدال والاسترجاع + سياسة المعاينة — بتتبعت بعد ما العميل يبعت العنوان بالتفصيل.
 *
 * ⚠️ async: بتحاول تجيب النص من إعدادات بلاجين ووردبريس الأول (عشان تقدري تعدّليه من
 * لوحة التحكم من غير كود)، ولو مش متاح أو فاضي بترجع للنص الافتراضي هنا في الكود.
 */
async function buildPolicyMessage() {
  const remote = await messageConfig.fetchBotMessages();
  if (remote && remote.policy_message) return remote.policy_message;

  return [
    'أهلاً بحضرتك ❤️',
    'حرصًا مننا على راحتك ووضوح سياسة الاستبدال والاسترجاع، حابين نوضح لحضرتك الآتي:',
    '✨ الاستبدال: متاح خلال 14 يوم من استلام الأوردر، بشرط أن يكون المنتج بنفس حالته الأصلية ولم يتم استخدامه.',
    '✨ في حالة وجود عيب بالمنتج (Defect): يتم تحمل نصف مصاريف الشحن فقط.',
    '✨ الاسترجاع: متاح خلال 14 يوم، ويتم خصم مصاريف الشحن كاملة من قيمة المبلغ المسترد.',
    'وبمجرد وصول الأوردر للفرع، بيتم فحص المنتج والتأكد من حالته وعدم وجود أي عيوب، وبعد التأكد بيتم تحويل المبلغ المستحق لحضرتك بعد خصم مصاريف الشحن.',
    'هدفنا دايمًا إن تجربة حضرتك معانا تكون سهلة ومريحة، وشكرًا لثقتك فينا 🤍✨',
    '',
    'تم تأكيد أوردرك من Dolley Store بنجاح! ✨',
    'يسعدنا جداً اختيارك لمنتجاتنا، وعشان يهمنا راحتك وسلامتك الصحية، بنوضح ليكي سياسة المعاينة عند الاستلام:',
    '1️⃣ المعاينة البصرية: متاح ليكي معاينة القطع (التأكد من الخامة، اللون، وجودة التقفيل) بالنظر فقط.',
    '2️⃣ القياس والاستخدام: حرصاً على الصحة العامة وخصوصية منتجات اللانجري والبجامات، يُمنع تماماً قياس القطع فوق الملابس وذلك لضمان وصول المنتج لكل عميلة "جديد تماماً" ولم يسبق استخدامه.',
    '3️⃣ المنتجات المستوردة: القطع التي تأتي في عبوات مغلقة (بلاستيك أو كرتون مصنعي) غير مسموح بفتح العبوة؛ حيث أن فتح غلاف المصنع يعتبر استلاماً نهائياً للمنتج.',
    '4️⃣ المقاسات: المقاسات موضحة بدقة (فري سايز لـ 85 كيلو)، ويمكنك التأكد من المقاس بالنظر دون لبس القطعة.',
    '',
    'نشكرك على تفهمك، ونتمنى ليكي تجربة تسوق ممتعة مع Dolley! 🎀',
    '',
    'لو موافقة على كل حاجة، رد بكلمة "تمام" أو "موافق" عشان نكمل تجهيز طلبك 🌷',
  ].join('\n');
}

/**
 * الرسالة الأخيرة بعد ما العميل يأكد الأوردر فعليًا — فيها التأكيد + عرض خصم 5%
 * إضافي لمدة 15 دقيقة لو حب يضيف قطعة تانية من الموقع.
 *
 * ⚠️ async: بتحاول تجيب النص من إعدادات بلاجين ووردبريس الأول (عشان تقدري تعدّليه من
 * لوحة التحكم من غير كود)، ولو مش متاح أو فاضي بترجع للنص الافتراضي هنا في الكود.
 */
async function buildConfirmationOfferMessage() {
  const remote = await messageConfig.fetchBotMessages();
  if (remote && remote.confirmation_offer_message) return remote.confirmation_offer_message;

  return [
    'حابة أتأكد من حضرتك على الأوردر، عشان نقدر نبدأ في تجهيزه ويتشحن لحضرتك في نفس اليوم.',
    'وفي خصم اضافي علشانك انتي بس لانك طبعا عميلة مميزة عندنا 🌸♥️',
    'لو حابة تضيفي أي قطعة تانية للأوردر، تقدري تشتريها من خلال الويب سايت وهيكون عليها خصم إضافي 5%.',
    'الخصم متاح لمدة 15 دقيقة بس من دلوقتي.',
    'ادخلي على الموقع من هنا: https://dolleystore.com',
    'لو حابة تضيفي حاجة، ابعتيلي وأنا أساعدك فيها ❤️',
  ].join('\n');
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
  buildOrderConfirmationTemplateParams,
  buildOrderConfirmedReply,
  buildAddressRequestMessage,
  buildPolicyMessage,
  buildConfirmationOfferMessage,
  buildOrderCancelledReply,
  buildEditAcknowledgedReply,
  buildUnclearReply,
  buildUpsellMessage,
};
