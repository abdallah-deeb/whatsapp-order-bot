const config = require('../config');

let anthropicClient = null;
function getClient() {
  if (!config.anthropic.apiKey) return null;
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return anthropicClient;
}

const SYSTEM_PROMPT = `أنت مساعد خدمة عملاء لمتجر إلكتروني مصري، بتشتغل على واتساب.
مهمتك الوحيدة: تقرأ رد العميل على رسالة تأكيد أوردر، وتحدد قصده، وترجع JSON فقط بدون أي نص إضافي بالشكل ده:

{
  "intent": "confirm" | "cancel" | "edit" | "unclear",
  "correctedAddress": string أو null,
  "note": string أو null,
  "suggestedReply": string
}

- "confirm": العميل موافق على كل البيانات زي ما هي.
- "cancel": العميل عايز يلغي الأوردر.
- "edit": العميل عايز يعدّل حاجة (عنوان، رقم، منتج...) بس مش عايز يلغي. لو التعديل خاص بالعنوان حط النص الجديد في correctedAddress. حط ملخص أي تعديل تاني في note.
- "unclear": مش واضح قصده، أو بيسأل سؤال عام.

suggestedReply لازم يكون رد قصير ومهذب بالعربي المصري (لهجة عامية بسيطة)، مناسب يتبعت للعميل مباشرة.
رجّع الـ JSON بس، من غير أي شرح أو نص زيادة.`;

function heuristicInterpret(message) {
  // بنطبّع الهمزات المختلفة (أ/إ/آ -> ا) عشان اختلافات الكتابة العامية متبوظش المطابقة
  const text = (message || '').trim().toLowerCase();
  const normalized = text.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

  const confirmWords = ['تمام', 'ايوه', 'اه', 'ok', 'okay', 'yes', 'موافق', 'صح', 'اكد'];
  const cancelWords = ['الغاء', 'الغي', 'مش عايز', 'مش محتاج', 'cancel'];
  // كلمات بتدل على إن العميل طالب تعديل حاجة تفصيلية (عنوان، رقم، منتج)
  const editIndicators = ['بس ', 'لكن', 'غير ', 'غيّر', 'عدل', 'عدّل', 'العنوان', 'الرقم', 'خطا', 'غلط'];

  if (cancelWords.some((w) => normalized.includes(w))) {
    return {
      intent: 'cancel',
      correctedAddress: null,
      note: 'العميل طلب إلغاء الأوردر',
      suggestedReply: null, // هيتبنى من القالب الجاهز
    };
  }

  const hasConfirmWord = confirmWords.some((w) => normalized.includes(w));
  const hasEditIndicator = editIndicators.some((w) => normalized.includes(w));

  // لو فيه كلمة تأكيد ومفيش أي إشارة لتعديل تفصيلي -> نعتبره تأكيد كامل، بصرف النظر عن طول الرسالة
  if (hasConfirmWord && !hasEditIndicator) {
    return {
      intent: 'confirm',
      correctedAddress: null,
      note: null,
      suggestedReply: null,
    };
  }

  if (hasEditIndicator || text.length > 8) {
    // فيه احتمال كبير إنه رد فيه تفاصيل (عنوان جديد مثلاً) لكن من غير AI مينفعش نفهمه بدقة
    return {
      intent: 'edit',
      correctedAddress: null,
      note: message,
      suggestedReply: null,
    };
  }

  return { intent: 'unclear', correctedAddress: null, note: null, suggestedReply: null };
}

async function interpretCustomerReply({ order, message }) {
  const client = getClient();

  if (!client) {
    // مفيش مفتاح Anthropic متسجل -> استخدم منطق بسيط بالكلمات المفتاحية (وضع تجريبي)
    return heuristicInterpret(message);
  }

  const userPrompt = `بيانات الأوردر:
رقم الأوردر: ${order.id}
اسم العميل: ${order.customerName}
العنوان الحالي: ${order.shippingAddress}
المنتجات: ${order.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}

رسالة العميل: "${message}"`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content?.[0]?.type === 'text' ? response.content[0].text : '{}';

  try {
    const parsed = JSON.parse(raw);
    return {
      intent: parsed.intent || 'unclear',
      correctedAddress: parsed.correctedAddress || null,
      note: parsed.note || null,
      suggestedReply: parsed.suggestedReply || null,
    };
  } catch (err) {
    console.error('⚠️ الـ AI رجّع رد مش JSON صالح:', raw);
    return heuristicInterpret(message);
  }
}

/**
 * اقتراح upsell/cross-sell بسيط بناءً على محتوى الأوردر.
 * ده prototype بقاعدة بيانات ثابتة صغيرة؛ في نظام حقيقي المفروض يجيب من كتالوج المتجر
 * (مثلاً منتجات بتتباع مع بعض كتير، أو باقة/إكسسوار مرتبط بنفس الفئة).
 */
const CROSS_SELL_CATALOG = [
  { keyword: 'تيشيرت', name: 'بنطلون جينز مناسب', reason: 'بيتباع كتير مع التيشيرتات دي' },
  { keyword: 'موبايل', name: 'جراب حماية + سكرين بروتكتور', reason: 'حماية إضافية لجهازك' },
  { keyword: 'حذاء', name: 'سبراي تنظيف وحماية الأحذية', reason: 'يخلي الحذاء يعيش أطول' },
];

function suggestCrossSell(order) {
  const itemNames = order.items.map((i) => i.name.toLowerCase()).join(' ');
  const match = CROSS_SELL_CATALOG.find((entry) => itemNames.includes(entry.keyword));
  return match ? { name: match.name, reason: match.reason } : null;
}

module.exports = { interpretCustomerReply, suggestCrossSell };
