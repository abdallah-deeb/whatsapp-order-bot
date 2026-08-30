const express = require('express');
const config = require('./config');
const wooWebhookRouter = require('./routes/wooWebhook');
const { router: whatsappWebhookRouter } = require('./routes/whatsappWebhook');
const orderStore = require('./services/orderStore');

const app = express();

// محتاجين الـ raw body عشان نتحقق من توقيع WooCommerce (HMAC) قبل ما نحوّله لـ JSON
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true })); // مطلوب لردود Twilio (form-encoded)

app.get('/health', (_req, res) => {
  res.json({ ok: true, provider: config.whatsappProvider, time: new Date().toISOString() });
});

// endpoint بسيط للمتابعة أثناء التجربة: يعرض كل الأوردرات وحالاتها في الذاكرة
app.get('/debug/orders', (_req, res) => {
  res.json(orderStore.listOrders());
});

app.use('/webhooks/woocommerce', wooWebhookRouter);
app.use('/webhooks/whatsapp', whatsappWebhookRouter);

// شبكة أمان: أي خطأ متوقّع مش هيوقف السيرفر كله (مهم جدًا لسيرفر بيستقبل traffic حقيقي من عملاء)
app.use((err, _req, res, _next) => {
  console.error('❌ خطأ غير متوقع في السيرفر:', err);
  res.status(500).json({ ok: false, error: 'internal_error' });
});
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
});

app.listen(config.port, () => {
  console.log(`🚀 السيرفر شغال على http://localhost:${config.port}`);
  console.log(`   وضع واتساب الحالي: ${config.whatsappProvider}`);
  console.log(`   جرّب: npm run simulate (في تيرمنال تاني) عشان تشوف تدفق كامل`);
});
