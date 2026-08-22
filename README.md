# بوت تأكيد الأوردرات على واتساب (AI + WooCommerce)

بروتوتايب شغال بالكامل: أوردر جديد في WooCommerce → رسالة تأكيد على واتساب → العميل يرد → الذكاء الاصطناعي يفهم الرد ويحدّث الأوردر → اقتراح upsell/cross-sell.

راجع خطة المشروع الكاملة (المعمارية، مقارنة مزودي واتساب، التوصيات) في المستند اللي اتبعت معاك، أو في مجلد `plan/` بالمشروع على claude.ai.

## التشغيل السريع (وضع تجريبي بالكامل — من غير أي مفاتيح API)

```bash
npm install
cp .env.example .env
npm start
```

في تيرمنال تاني:

```bash
npm run simulate          # سيناريو تأكيد الأوردر
npm run simulate cancel   # سيناريو إلغاء
npm run simulate edit     # سيناريو طلب تعديل عنوان
```

هتلاقي في التيرمنال اللي شغال فيه `npm start` كل الرسائل اللي "المفروض" تتبعت على واتساب، وتقدر كمان تفتح `http://localhost:3000/debug/orders` عشان تشوف حالة كل أوردر.

في الوضع ده (`WHATSAPP_PROVIDER=mock` و `ANTHROPIC_API_KEY` فاضي)، السيستم بيستخدم:
- طباعة الرسائل في الكونسول بدل إرسالها فعليًا
- منطق بسيط بالكلمات المفتاحية بدل الـ AI لفهم رد العميل (كافي لتجربة التدفق العام، لكن مش بديل عن الـ AI الحقيقي لفهم ردود متنوعة)

## الخطوة الجاية: تجربة حقيقية على واتساب فعلي (دقايق، مجانًا)

1. اعمل حساب على [Twilio](https://www.twilio.com) وفعّل [WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) (بيدّيك خطوات تربط رقمك الشخصي بالساندبوكس عشان تجرب).
2. حط في `.env`:
   ```
   WHATSAPP_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   ```
3. عشان تستقبل ردود حقيقية، السيرفر لازم يكون متاح على الإنترنت (استخدم [ngrok](https://ngrok.com) مثلاً: `ngrok http 3000`)، وحط الرابط + `/webhooks/whatsapp/twilio` في إعدادات Twilio Sandbox ("WHEN A MESSAGE COMES IN").
4. جرّب تبعتلك رسالة فعلية على واتساب (عن طريق ضبط رقم موبايلك كـ `customerPhone` في أوردر تجريبي)، ورد عليها من موبايلك.

## تفعيل الذكاء الاصطناعي الحقيقي (Claude)

حط في `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```
من غيرها، السيستم هيفضل شغال بالمنطق البسيط بالكلمات المفتاحية (مفيد للتجربة، لكن مش هيفهم ردود معقدة أو تعديلات تفصيلية زي "غيّر الأوردر لو سمحت اعمله لون تاني" بنفس الدقة).

## ربط متجر WooCommerce حقيقي

1. من لوحة تحكم WordPress: WooCommerce > الإعدادات > متقدم > REST API، اعمل مفتاح جديد (Read/Write) وهات `Consumer Key` و`Consumer Secret`.
2. من نفس القسم "Webhooks"، اعمل webhook جديد:
   - Topic: **Order created**
   - Delivery URL: `https://your-server.com/webhooks/woocommerce/order-created`
   - Secret: أي نص قوي، وحطه في `WOOCOMMERCE_WEBHOOK_SECRET`
3. حط باقي بيانات `.env`:
   ```
   WOOCOMMERCE_BASE_URL=https://your-store.com
   WOOCOMMERCE_CONSUMER_KEY=ck_...
   WOOCOMMERCE_CONSUMER_SECRET=cs_...
   WOOCOMMERCE_WEBHOOK_SECRET=...نفس السر اللي حطيته فوق
   ```

## الانتقال لـ Meta WhatsApp Cloud API (رسمي، للإنتاج)

1. اعمل Facebook Business Manager موثّق + WhatsApp Business Account (خطوات ميتا الرسمية).
2. هات `Phone Number ID` و`Access Token` من [Meta for Developers](https://developers.facebook.com).
3. حط في `.env`:
   ```
   WHATSAPP_PROVIDER=meta
   META_WHATSAPP_TOKEN=...
   META_PHONE_NUMBER_ID=...
   META_VERIFY_TOKEN=اي-نص-تختاره
   ```
4. في إعدادات الـ Webhook على Meta Developer Console، حط `https://your-server.com/webhooks/whatsapp/meta` وحط نفس `META_VERIFY_TOKEN`.
5. لازم تعمل "Message Template" لرسالة تأكيد الأوردر وتاخد موافقة ميتا عليها قبل ما تستخدمها (بتاخد من ساعات لكام يوم).

## هيكل المشروع

```
src/
  server.js              نقطة تشغيل السيرفر
  config.js              قراءة إعدادات .env
  routes/
    wooWebhook.js         استقبال أوردر جديد من WooCommerce
    whatsappWebhook.js     استقبال ردود العملاء (Twilio/Meta) + منطق المعالجة الرئيسي
  services/
    whatsapp.js            إرسال الرسائل (mock/Twilio/Meta)
    woocommerce.js          التعامل مع WooCommerce REST API
    ai.js                   فهم رد العميل بالـ Claude (أو منطق بديل بسيط)
    orderStore.js           تخزين مؤقت لحالة الأوردرات (in-memory)
    templates.js            نصوص الرسائل بالعربي
  utils/
    verifyWooSignature.js   التحقق من توقيع WooCommerce webhook
scripts/
  simulate.js              محاكاة تدفق كامل محليًا بدون أي مفاتيح API
```

## ملاحظات مهمة قبل الإنتاج

- `orderStore.js` بيخزن الحالة في الذاكرة بس — لازم يتستبدل بقاعدة بيانات حقيقية (Postgres/Redis) قبل الإنتاج، وإلا هتضيع كل البيانات لو السيرفر عمل restart.
- لازم مراجعة بشرية لحالات "edit" الحساسة (تغيير عنوان، تغيير منتج) قبل ما تتنفذ أوتوماتيك بالكامل — الكود الحالي بيسجلها كملاحظة على الأوردر عشان موظف يراجعها، وده مقصود لتقليل المخاطرة.
- لازم Opt-in واضح من العميل للتواصل معاه على واتساب (عادة بيتحقق تلقائيًا من كونه دخل رقمه وعمل الأوردر بنفسه على المتجر، لكن يُفضل تنويه واضح في صفحة الأوردر).
