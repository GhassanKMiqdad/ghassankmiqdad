# النشر: Firebase + Next.js

هذا الدليل يشرح إعداد مشروع Firebase الذي زوّدنا به المستخدم (`research-team-platform`) ونشر تطبيق Next.js. مفاتيح Firebase الظاهرة في إعداد الويب عامة بطبيعتها؛ **مفتاح حساب الخدمة خاص بالخادم فقط**.

## 1. جهّز Firebase

من Firebase Console للمشروع `research-team-platform`:

1. فعّل **Authentication → Sign-in method → Email/Password**، وأضف نطاق الموقع المنشور إلى **Authorized domains**.
2. اضبط قوالب رسائل التحقق وإعادة تعيين كلمة المرور، وتأكد من أن روابط الاستمرار تعود إلى `/auth/confirm` على نطاق الموقع.
3. أنشئ Cloud Firestore في وضع الإنتاج.
4. أنشئ/تحقق من حاوية Cloud Storage الافتراضية `research-team-platform.firebasestorage.app`، ولا تجعلها عامة.
5. أنشئ حساب خدمة للخادم بصلاحيات Firebase Admin اللازمة للمصادقة وFirestore وStorage، أو استخدم Application Default Credentials على بيئة Google Cloud.

لم تُنشر القواعد إلى المشروع خلال هذه المهمة؛ راجع الهدف والقواعد قبل تنفيذ أمر النشر في الخطوة 4.

## 2. متغيرات البيئة

انسخ `.env.example` إلى `.env.local` محليًا، أو أضف القيم في إعدادات استضافة Next.js:

- `NEXT_PUBLIC_FIREBASE_API_KEY` وبيانات تطبيق الويب العامة: مأخوذة من إعداد تطبيق Firebase على الويب.
- `FIREBASE_PROJECT_ID=research-team-platform`.
- `FIREBASE_STORAGE_BUCKET=research-team-platform.firebasestorage.app`.
- `FIREBASE_SERVICE_ACCOUNT_JSON` أو الزوج `FIREBASE_CLIENT_EMAIL` و`FIREBASE_PRIVATE_KEY`، أو ADC على Google Cloud.
- `NEXT_PUBLIC_SITE_URL` للنطاق الأساسي، و`PLATFORM_ADMIN_EMAILS` لرسائل المدير الأول، و`APP_TIMEZONE` و`NEXT_PUBLIC_DEFAULT_LOCALE` حسب الحاجة.

**لا** تضع بيانات حساب الخدمة في متغير يبدأ بـ `NEXT_PUBLIC_`، ولا تحفظها في GitHub. قيّد Firebase API key على واجهات Identity Toolkit المطلوبة حيثما أمكن.

## 3. إعداد التطبيق محليًا

```bash
npm ci
cp .env.example .env.local
# أدخل اعتماد Admin SDK في .env.local
npm run test:firebase
npm run typecheck
npm run build
npm run dev
```

يتطلب محاكي Firebase Java 21 أو أحدث. يتطلب تدفق الرفع إعداد CORS لحاوية Cloud Storage بحيث تسمح بنطاق التطبيق الفعلي وطريقة `POST` ورأس `Content-Type`؛ الروابط الموقّعة نفسها محدودة بملف ومسار محددين، ونوع المحتوى، وحجم أقصى 50 MB.

## 4. مراجعة ونشر القواعد والفهارس

ملف `.firebaserc` يحدد `research-team-platform` كهدف CLI افتراضي. تحقّق من المشروع الحالي قبل النشر، خصوصًا إذا كان يحتوي بيانات أو قواعد موجودة.

```bash
firebase use research-team-platform
firebase emulators:exec --project demo-research-platform --only firestore,storage "vitest run --config vitest.firebase.config.mts"
firebase deploy --only firestore:rules,firestore:indexes,storage
```

انشر القواعد والفهارس أولًا إلى بيئة اختبار إن توفرت، وافحص سجلات Firebase والواجهة. تجنّب استبدال قواعد إنتاج قائمة قبل أخذ نسخة ومراجعة أثر التغيير.

## 5. نشر Next.js

على Vercel أو مضيف Node متوافق:

1. اربط مستودع GitHub وحدد مجلد التطبيق `research-team-platform` كـ Root Directory إذا كان المستودع الأكبر يحتوي مجلدات أخرى.
2. أضف متغيرات Firebase العامة والخاصة إلى **Server Environment Variables**. لا تضع بيانات Admin في إعدادات المتصفح.
3. أضف `PLATFORM_ADMIN_EMAILS`، و`NEXT_PUBLIC_SITE_URL` بالنطاق النهائي، و`APP_TIMEZONE` و`NEXT_PUBLIC_DEFAULT_LOCALE`.
4. انشر نسخة معاينة، واختبر إنشاء الحساب وتأكيد البريد وتسجيل الدخول والصلاحيات والرفع والتنزيل والتنبيهات، ثم انشر الإنتاج.
5. أضف النطاق إلى Firebase Auth **Authorized domains**، وتحقق من قوالب البريد وعناوين الاستمرار.

## 6. التحقق بعد النشر

- لا يمكن للمستخدم غير المسجل الوصول إلى صفحات التطبيق المحمية.
- المستخدم يرى مشاريعه ومهامه المصرح بها فقط؛ تعديل المعرف في الرابط لا يمنح صلاحية.
- العضو الباحث لا يستطيع تغيير تعريف المهمة أو المعين أو صلاحيات الفريق.
- ملفات التخزين خاصة؛ لا تستخدم روابط عامة دائمة.
- إشعارات Firestore تخص المستلم وحده.
- العربية RTL والإنجليزية LTR، وعلى الهاتف لا يحدث تجاوز أفقي غير مقصود.

## 7. بيانات Supabase السابقة والاسترجاع

لم تُنقل بيانات Supabase تلقائيًا، ولم يُحذف المشروع القديم. قبل تحويل نطاق الإنتاج:

1. خذ نسخة مستقلة ومتحققًا منها من قاعدة PostgreSQL وملفات Storage.
2. نفّذ أداة استيراد منفصلة بعد اختبار تحويل الجداول والعلاقات والأذونات والملفات في مشروع Firebase مؤقت.
3. خطط لإعادة تعيين كلمات المرور/تأكيد الحسابات؛ لا تفترض إمكان نقل تجزئات كلمات مرور Supabase إلى Firebase.
4. طابق أعداد السجلات وعينات الملفات والصلاحيات، ثم اختبر حسابات بأدوار مختلفة.
5. لا تحذف أو توقف Supabase إلا بعد قبول الترحيل وخطة رجوع موثقة.
