# النشر: Firebase + Next.js

يوضح هذا الدليل إعداد مشروع Firebase الذي زوّدنا به المستخدم (`research-team-platform`) ونشر تطبيق Next.js **بعد اختبار نسخة مرحلية**. مفاتيح Firebase الظاهرة في إعداد الويب عامة بطبيعتها؛ **مفتاح حساب الخدمة خاص بالخادم فقط**.

## 1. تجهيز Firebase

في Firebase Console لبيئة الاختبار:

1. فعّل **Authentication → Sign-in method → Email/Password**، وأضف نطاق الموقع إلى **Authorized domains**.
2. اضبط قوالب التحقق وإعادة تعيين كلمة المرور وروابط الاستمرار إلى `/auth/confirm` على نطاق التطبيق.
3. أنشئ Cloud Firestore في وضع الإنتاج، وفعّل حاوية Cloud Storage الخاصة.
4. أنشئ حساب خدمة للخادم بصلاحيات Firebase Admin اللازمة أو استخدم Application Default Credentials على Google Cloud.
5. إذا أردت تشغيل تنبيهات المواعيد، فعّل واجهات Cloud Functions وCloud Scheduler وCloud Run وArtifact Registry. نشر الوظائف المجدولة يتطلب مشروعًا مرتبطًا بالفوترة وفق متطلبات Firebase/Google Cloud الحالية.

لم تُنشر القواعد أو الفهارس أو الوظيفة إلى أي مشروع خلال هذه المهمة.

## 2. متغيرات البيئة

انسخ `.env.example` إلى `.env.local` محليًا أو أضف القيم في إعدادات استضافة Next.js:

- `NEXT_PUBLIC_FIREBASE_API_KEY` وبقية بيانات تطبيق الويب العامة من إعداد Firebase.
- `FIREBASE_PROJECT_ID` و`FIREBASE_STORAGE_BUCKET`.
- `FIREBASE_SERVICE_ACCOUNT_JSON` أو `FIREBASE_CLIENT_EMAIL` و`FIREBASE_PRIVATE_KEY`، أو ADC على Google Cloud.
- `NEXT_PUBLIC_SITE_URL` و`PLATFORM_ADMIN_EMAILS` و`APP_TIMEZONE` و`NEXT_PUBLIC_DEFAULT_LOCALE` حسب الحاجة.

لا تضع بيانات حساب الخدمة في متغير يبدأ بـ `NEXT_PUBLIC_`، ولا تحفظها في GitHub. قيّد مفتاح Firebase API على واجهات Identity Toolkit اللازمة حيثما أمكن.

بالنسبة إلى Cloud Functions، يتوقع المجدول `APP_TIMEZONE` ويستخدم `UTC` إن لم تُحدد قيمة. يمكن ضبط متغيرات الوظائف في ملف بيئة محلي غير ملتزم بالمستودع داخل `functions/` (مثل `.env.<staging-project-id>`) قبل النشر؛ لا تضف أي أسرار إليه. تبقى الوظيفة على المنطقة `us-central1` وجدولها اليومي 08:00 بالتوقيت المحدد.

## 3. إعداد التطبيق محليًا

```bash
npm ci
npm ci --prefix functions
cp .env.example .env.local
# أدخل اعتماد Admin SDK محليًا فقط
npm test
npm run test:migration
npm run typecheck
npm run test:firebase
npm run lint
npm run format:check
npm --prefix functions run lint
npm run build
npm run dev
```

يتطلب محاكي Firebase Java 21 أو أحدث. يتطلب تدفق الرفع إعداد CORS لحاوية Storage بحيث تسمح بنطاق التطبيق الفعلي وطريقة `POST` ورأس `Content-Type`؛ الروابط الموقعة محدودة بملف ومسار ونوع محتوى محددين وحجم أقصى 50 MB.

## 4. مراجعة ونشر القواعد والفهارس إلى بيئة مرحلية

ملف `.firebaserc` يحدد `research-team-platform` هدفًا افتراضيًا؛ لا تعتمد عليه للنشر. تحقّق يدويًا من المشروع النشط وأنه **بيئة اختبار**.

```bash
firebase use <staging-project-id>
firebase emulators:exec --project demo-research-platform --only firestore,storage "vitest run --config vitest.firebase.config.mts"
firebase deploy --only firestore:rules,firestore:indexes,storage
```

اختبر الحسابات والأدوار وقواعد الوصول والرفع والتنزيل في المرحلة، ثم افحص السجلات. تجنّب استبدال قواعد إنتاج قائمة قبل أخذ نسخة ومراجعة الأثر.

## 5. نشر مجدول تنبيهات المواعيد إلى المرحلة (اختياري)

وظيفة `scheduledDeadlineNotifications` ترسل إشعارًا داخل التطبيق قبل يوم من موعد المهمة، ثم إشعارًا واحدًا عند تجاوز الموعد، للباحث المعين فقط بعد التحقق من عضويته النشطة بالمشروع والفريق. معرّفات الإشعارات حتمية لتكون إعادة المحاولة آمنة. لا ترسل الوظيفة بريدًا أو إشعارات هاتفية.

```bash
npm ci --prefix functions
npm --prefix functions run lint
firebase use <staging-project-id>
# تحقّق من APP_TIMEZONE في إعداد بيئة الوظائف المرحلية قبل النشر
firebase deploy --only functions:scheduledDeadlineNotifications,firestore:indexes
```

تحقّق من إنشاء Cloud Scheduler job ومن سجلات Function وظهور إشعار لمستخدم اختبار مخوّل. لا تنشر إلى الإنتاج حتى تُجتاز هذه الخطوات. المصدر موجود في `functions/src/` لكن الوظيفة لم تُنشر ولم تُختبر بعد داخل محاكي Functions في هذا التنفيذ.

## 6. نشر Next.js

على Vercel أو مضيف Node متوافق:

1. اربط مستودع GitHub وحدد `research-team-platform` مجلدًا للتطبيق إذا احتوى المستودع مجلدات أخرى.
2. أضف قيم Firebase العامة والخاصة إلى إعدادات البيئة الخادمية؛ لا تضع بيانات Admin في المتصفح.
3. اضبط `PLATFORM_ADMIN_EMAILS` و`NEXT_PUBLIC_SITE_URL` والنطاقات المصرح بها و`APP_TIMEZONE` و`NEXT_PUBLIC_DEFAULT_LOCALE`.
4. انشر معاينة، واختبر إنشاء الحساب وتأكيد البريد وتسجيل الدخول والصلاحيات والفرق والمهام والإرسال/المراجعة والتقويم والتقارير والرفع والتنزيل والتنبيهات على الهاتف.
5. لا تنشر إلى الإنتاج إلا بعد مطابقة سجلات الاختبار وخطة الرجوع وموافقة مالك المشروع على التغيير.

## 7. تحقق ما بعد النشر

- لا يصل المستخدم غير المسجل إلى صفحات التطبيق المحمية.
- يرى المستخدم مشاريعه ومهامه المصرح بها فقط؛ تعديل المعرّف في الرابط لا يمنح صلاحية.
- لا يستطيع الباحث تغيير تعريف المهمة أو موعدها أو تعيينها أو عضوية الفريق.
- لا يمكن تغيير حالة المهمة من عميل Firestore مباشرة؛ التغييرات تمر عبر المسار الخادمي المراجع.
- ملفات Storage خاصة، وتنبيهات الموعد تخص الباحث النشط المعين وحده.
- العربية RTL والإنجليزية LTR، ولا يحدث تجاوز أفقي غير مقصود على الهاتف.

## 8. بيانات Supabase السابقة والاسترجاع

لم تُنقل بيانات Supabase تلقائيًا ولم يُحذف المشروع القديم. أداة الاستيراد المحلية تبدأ بوضع dry-run، وتقيّد apply بمحاكي Firestore محلي ومعرّفات `demo-*`؛ لم تُنفّذ أي عملية ترحيل إنتاجية. راجع [دليل ترحيل البيانات](MIGRATION_RUNBOOK.md) قبل إعداد تصدير أو تجربة.

1. خذ نسخة مستقلة ومتحققًا منها من قاعدة PostgreSQL وملفات Storage.
2. اختبر تحويل السجلات والعلاقات والصلاحيات والملفات في مشروع Firebase مؤقت.
3. خطط لإعادة تعيين كلمات المرور/تأكيد الحسابات؛ لا تفترض إمكان نقل تجزئات كلمات المرور إلى Firebase.
4. طابق أعداد السجلات وعينات الملفات والصلاحيات، ثم اختبر حسابات بأدوار مختلفة.
5. لا تحذف أو توقف Supabase إلا بعد قبول الترحيل وخطة رجوع موثقة.
