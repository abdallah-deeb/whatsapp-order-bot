const axios = require('axios');
const config = require('../config');

function isConfigured() {
  return Boolean(
    config.woocommerce.baseUrl &&
    config.woocommerce.consumerKey &&
    config.woocommerce.consumerSecret
  );
}

function client() {
  return axios.create({
    baseURL: `${config.woocommerce.baseUrl.replace(/\/$/, '')}/wp-json/wc/v3`,
    auth: {
      username: config.woocommerce.consumerKey,
      password: config.woocommerce.consumerSecret,
    },
  });
}

/**
 * بيحوّل رقم موبايل مصري من الصيغة المحلية اللي بتتسجل في الأوردر
 * (زي 01012401365) للصيغة الدولية اللي واتساب/واتي محتاجينها (201012401365).
 * من غير التحويل ده، الرسالة مش بتوصل خالص لأن الرقم مش بيبقى معرّف واتساب حقيقي —
 * ده كان سبب المشكلة اللي بنشخصها.
 */
function normalizeEgyptPhone(rawPhone) {
  let digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return '';

  // بعض الصيغ القديمة بتكتب 00 بدل علامة + في الأول (مثال: 0020101...)
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // الرقم مكتوب بالفعل بالصيغة الدولية (201012401365 - كود مصر 20 + رقم محلي بدون الصفر، 12 رقم بالظبط)
  if (digits.startsWith('20') && digits.length === 12) {
    return digits;
  }

  // الصيغة المحلية العادية (01012401365 أو حتى بدون الصفر) — نشيل أي أصفار في الأول ونضيف كود مصر
  digits = digits.replace(/^0+/, '');
  return digits ? `20${digits}` : '';
}

/**
 * بيحوّل payload الأوردر الخام اللي جاي من WooCommerce webhook لشكل مبسط
 * أسهل في الاستخدام في باقي السيستم.
 */
function normalizeWooOrderPayload(raw) {
  const billing = raw.billing || {};
  const shipping = raw.shipping || {};
  const addressParts = [
    shipping.address_1 || billing.address_1,
    shipping.address_2 || billing.address_2,
    shipping.city || billing.city,
    shipping.state || billing.state,
  ].filter(Boolean);

  return {
    id: String(raw.id),
    customerName: `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || 'عميلنا العزيز',
    // customerPhone دايمًا بالصيغة الدولية الكاملة — ده اللي بيتبعت بيه فعليًا على واتساب.
    customerPhone: normalizeEgyptPhone(billing.phone),
    // customerPhoneDisplay هو الرقم زي ما العميلة كتبته بالظبط — بيتعرض في نص الرسالة بس، مش بيتبعت بيه.
    customerPhoneDisplay: billing.phone || '',
    shippingAddress: addressParts.join('، ') || 'مفيش عنوان مسجل',
    paymentMethod: raw.payment_method_title || raw.payment_method || 'غير محدد',
    total: raw.total,
    currency: raw.currency || 'EGP',
    items: (raw.line_items || []).map((li) => ({
      name: li.name,
      quantity: li.quantity,
      productId: li.product_id,
    })),
    status: raw.status,
    state: 'awaiting_confirmation',
    createdAt: new Date().toISOString(),
  };
}

/**
 * بيجيب أوردر واحد من ووكومرس مباشرة (مش من الذاكرة المحلية) — مفيد لما نحتاج نتأكد
 * من أحدث بيانات الأوردر، مثلاً عند الإرسال اليدوي لأوردر ممكن يكون السيرفر عمل
 * restart من بعد ما اتعمل (وبالتالي راح من التخزين المؤقت في الذاكرة).
 */
async function getOrder(orderId) {
  if (!isConfigured()) {
    throw new Error('WooCommerce مش متوصل — مش هينفع نجيب الأوردر');
  }
  const res = await client().get(`/orders/${orderId}`);
  return normalizeWooOrderPayload(res.data);
}

async function updateOrderStatus(orderId, status) {
  if (!isConfigured()) {
    console.log(`ℹ️ [WooCommerce mock] كان المفروض يتحدّث الأوردر #${orderId} لحالة "${status}" (WooCommerce مش متوصل فعليًا دلوقتي)`);
    return { ok: true, mock: true };
  }
  const res = await client().put(`/orders/${orderId}`, { status });
  return { ok: true, data: res.data };
}

async function addOrderNote(orderId, note, customerNote = false) {
  if (!isConfigured()) {
    console.log(`ℹ️ [WooCommerce mock] ملاحظة كانت هتتضاف على الأوردر #${orderId}: "${note}"`);
    return { ok: true, mock: true };
  }
  const res = await client().post(`/orders/${orderId}/notes`, { note, customer_note: customerNote });
  return { ok: true, data: res.data };
}

async function updateOrderShippingAddress(orderId, addressLine) {
  if (!isConfigured()) {
    console.log(`ℹ️ [WooCommerce mock] كان المفروض يتحدّث عنوان الأوردر #${orderId} لـ: "${addressLine}"`);
    return { ok: true, mock: true };
  }
  // بنسيب تحديث العنوان الفعلي كملاحظة + address_1 بسيط؛ في نظام إنتاج حقيقي يفضل تفصيل الحقول
  const res = await client().put(`/orders/${orderId}`, {
    shipping: { address_1: addressLine },
    billing: { address_1: addressLine },
  });
  return { ok: true, data: res.data };
}

module.exports = {
  isConfigured,
  normalizeEgyptPhone,
  normalizeWooOrderPayload,
  getOrder,
  updateOrderStatus,
  addOrderNote,
  updateOrderShippingAddress,
};
