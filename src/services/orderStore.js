/**
 * تخزين مؤقت (in-memory) لحالة كل أوردر ومحادثته على واتساب.
 *
 * ده مناسب للتجربة والـ prototype بس. في الإنتاج لازم يتستبدل بقاعدة بيانات
 * حقيقية (Postgres/MySQL/Redis) عشان البيانات متضيعش لما السيرفر يعمل restart،
 * ولو حابب تشغل أكتر من نسخة من السيرفر في نفس الوقت.
 */

const ordersById = new Map();
// فهرس ثانوي عشان نلاقي الأوردر بسرعة من رقم موبايل العميل (لما يوصل رد على واتساب)
const orderIdsByPhone = new Map();

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '').replace(/^0+/, '');
}

function saveOrder(order) {
  ordersById.set(order.id, order);
  const normalized = normalizePhone(order.customerPhone);
  if (normalized) {
    const list = orderIdsByPhone.get(normalized) || [];
    // نحط الأوردر الجديد الأول عشان أي رد جديد من العميل يترتبط بأحدث أوردر ليه
    orderIdsByPhone.set(normalized, [order.id, ...list.filter((id) => id !== order.id)]);
  }
  return order;
}

function getOrder(orderId) {
  return ordersById.get(orderId) || null;
}

/**
 * بيدور على آخر أوردر "لسه مستني رد" لصاحب الرقم ده.
 * في نظام حقيقي ممكن تحتاج منطق أدق (مثلاً لو عنده أكتر من أوردر مفتوح في نفس الوقت).
 */
function findPendingOrderByPhone(phone) {
  const normalized = normalizePhone(phone);
  const ids = orderIdsByPhone.get(normalized) || [];
  for (const id of ids) {
    const order = ordersById.get(id);
    if (order && order.state === 'awaiting_confirmation') return order;
  }
  // لو مفيش أوردر لسه مستني رد، رجّع آخر أوردر لصاحب الرقم على أي حال (يفيد في الرد على استفسارات بعد التأكيد)
  if (ids.length > 0) return ordersById.get(ids[0]);
  return null;
}

function listOrders() {
  return Array.from(ordersById.values());
}

module.exports = {
  saveOrder,
  getOrder,
  findPendingOrderByPhone,
  listOrders,
  normalizePhone,
};
