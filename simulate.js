/**
 * سكريبت محاكاة كامل للتدفق، من غير أي حاجة حقيقية (لا WooCommerce ولا واتساب فعلي):
 *  1) يبعت "أوردر جديد" وهمي لسيرفرنا (زي ما WooCommerce كان هيبعته فعلاً)
 *  2) يستنى شوية، وبعدين يبعت "رد عميل" وهمي (تأكيد، تعديل، أو إلغاء - حسب الباراميتر)
 *
 * تشغيل: npm run simulate
 * أو:    node scripts/simulate.js confirm|cancel|edit
 */
const http = require('http');
const crypto = require('crypto');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const scenario = process.argv[2] || 'confirm';
const WEBHOOK_SECRET = process.env.WOOCOMMERCE_WEBHOOK_SECRET || '';

function post(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...extraHeaders,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const fakeWooOrder = {
  id: 9001,
  status: 'pending',
  currency: 'EGP',
  total: '450.00',
  payment_method_title: 'الدفع عند الاستلام',
  billing: {
    first_name: 'محمد',
    last_name: 'أحمد',
    phone: '201001234567',
    address_1: '15 شارع النصر',
    city: 'القاهرة',
  },
  shipping: {
    address_1: '15 شارع النصر',
    city: 'القاهرة',
  },
  line_items: [
    { name: 'تيشيرت قطن أزرق', quantity: 2, product_id: 101 },
    { name: 'بنطلون جينز', quantity: 1, product_id: 202 },
  ],
};

const replies = {
  confirm: 'تمام كده تمام، أيوه أكد الأوردر',
  cancel: 'لأ، عايز ألغي الأوردر ده',
  edit: 'العنوان غلط، العنوان الصح هو 22 شارع الجامعة، الجيزة',
};

async function main() {
  console.log(`\n=== محاكاة سيناريو: ${scenario} ===\n`);

  console.log('1) بنبعت أوردر جديد وهمي...');
  let headers = {};
  if (WEBHOOK_SECRET) {
    // نفس طريقة WooCommerce الحقيقية في توقيع الـ payload
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(JSON.stringify(fakeWooOrder))
      .digest('base64');
    headers['x-wc-webhook-signature'] = signature;
  }
  const orderRes = await post('/webhooks/woocommerce/order-created', fakeWooOrder, headers);
  console.log('   الرد من السيرفر:', orderRes.status, orderRes.body);

  await new Promise((r) => setTimeout(r, 1000));

  console.log('\n2) بنحاكي رد العميل على واتساب...');
  const replyText = replies[scenario] || replies.confirm;
  console.log(`   العميل بيرد بـ: "${replyText}"`);
  const replyRes = await post('/webhooks/whatsapp/test-incoming', {
    from: fakeWooOrder.billing.phone,
    text: replyText,
  });
  console.log('   الرد من السيرفر:', replyRes.status, replyRes.body);

  console.log('\n✅ خلصت المحاكاة. شوف اللوج فوق في التيرمنال اللي شغال فيه npm start.');
  console.log('   أو زور http://localhost:3000/debug/orders عشان تشوف حالة الأوردر.\n');
}

main().catch((err) => {
  console.error('❌ حصل خطأ أثناء المحاكاة:', err.message);
  console.error('   تأكد إن السيرفر شغال (npm start) في تيرمنال تاني الأول.');
  process.exit(1);
});
