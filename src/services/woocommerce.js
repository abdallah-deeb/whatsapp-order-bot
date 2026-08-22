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
    customerPhone: billing.phone || '',
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
  normalizeWooOrderPayload,
  updateOrderStatus,
  addOrderNote,
  updateOrderShippingAddress,
};
