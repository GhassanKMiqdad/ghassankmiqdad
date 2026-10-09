# النشر المجاني: Supabase + Vercel

دليل خطوة بخطوة لنشر المنصة على خطط مجانية:

| الخدمة                           | الخطة          | الدور                                              |
| -------------------------------- | -------------- | -------------------------------------------------- |
| [Supabase](https://supabase.com) | Free           | قاعدة البيانات، تسجيل الدخول، تخزين الملفات        |
| [Vercel](https://vercel.com)     | Hobby (مجانية) | تشغيل تطبيق Next.js على رابط `https://…vercel.app` |
| Gmail (اختياري لكن مستحسن)       | مجاني          | إرسال رسائل التأكيد والدعوات واستعادة كلمة المرور  |

لا تحتاج إلى بطاقة ائتمان ولا إلى تثبيت أي برنامج على جهازك.

> قبل البدء: ادمج طلب الدمج (Pull Request) في الفرع `main`؛ Vercel ينشر نسخة الإنتاج من `main`.

## 1. إنشاء مشروع Supabase

1. ادخل إلى [supabase.com](https://supabase.com) وسجّل بحساب GitHub.
2. اضغط **New project** واختر:
   - **Name:** مثل `research-team`.
   - **Database Password:** كلمة مرور قوية، واحفظها في مكان آمن.
   - **Region:** أقرب منطقة لمستخدميك (مثل Central EU – Frankfurt).
   - **Plan:** Free.
3. انتظر دقيقة أو دقيقتين حتى يجهز المشروع.

## 2. تجهيز قاعدة البيانات

اختر طريقة واحدة فقط، ونفّذها مرة واحدة على المشروع الجديد.

### الطريقة (أ): من المتصفح — الأسهل

1. احصل على ملف `supabase-setup.sql`: من جهازك داخل المجلد `research-team-platform` نفّذ
   `npm run db:bundle`، أو استخدم نسخة جاهزة من الملف.
2. في لوحة Supabase افتح **SQL Editor** ← **New query**.
3. الصق محتوى الملف كاملًا واضغط **Run**. إن ظهر تنبيه عن عمليات حذف محتملة فوافق؛ السكربت
   يعمل داخل معاملة واحدة على مشروع فارغ، ويرفض التنفيذ إذا كانت المنصة مثبتة مسبقًا.
4. النتيجة المتوقعة: `Success. No rows returned`.

### الطريقة (ب): من سطر الأوامر

تحتاج Node.js على جهازك:

```bash
git clone https://github.com/GhassanKMiqdad/ghassankmiqdad.git
cd ghassankmiqdad/research-team-platform
npx supabase login
npx supabase link --project-ref <PROJECT_REF>   # يطلب كلمة مرور قاعدة البيانات
npx supabase db push
```

`PROJECT_REF` هو الجزء الأول من رابط المشروع: `https://<PROJECT_REF>.supabase.co`.

الطريقتان تسجّلان الترحيلات (migrations) بالطريقة نفسها، لذلك يمكن تطبيق أي ترحيلات
مستقبلية دائمًا بالأمر `npx supabase db push`.

## 3. نسخ الرابط والمفاتيح من Supabase

من **Project Settings**:

| القيمة                               | المكان                                       | المتغير في Vercel               |
| ------------------------------------ | -------------------------------------------- | ------------------------------- |
| Project URL                          | **Data API** (أو زر **Connect** أعلى اللوحة) | `NEXT_PUBLIC_SUPABASE_URL`      |
| Publishable key (`sb_publishable_…`) | **API Keys**                                 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Secret key (`sb_secret_…`)           | **API Keys**                                 | `SUPABASE_SERVICE_ROLE_KEY`     |

تعمل أيضًا المفاتيح القديمة (`anon` و`service_role`) من تبويب **Legacy API Keys**.

> المفتاح السري (Secret) للخادم فقط: لا تضعه في متغير يبدأ بـ `NEXT_PUBLIC_`، ولا في
> GitHub، ولا ترسله لأحد.

## 4. النشر على Vercel

1. ادخل إلى [vercel.com](https://vercel.com) وسجّل بحساب GitHub (خطة Hobby).
2. **Add New… ← Project**، ثم اختر المستودع `ghassankmiqdad` (امنح Vercel صلاحية الوصول إليه
   إن طُلب منك).
3. في شاشة الإعداد:
   - **Root Directory:** اضغط **Edit** واختر `research-team-platform` — هذه أهم خطوة.
   - **Framework Preset:** يُكتشف تلقائيًا (Next.js).
   - **Environment Variables:** أضف:

     | المتغير                         | القيمة                                        |
     | ------------------------------- | --------------------------------------------- |
     | `NEXT_PUBLIC_SUPABASE_URL`      | Project URL                                   |
     | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key                               |
     | `SUPABASE_SERVICE_ROLE_KEY`     | Secret key                                    |
     | `PLATFORM_ADMIN_EMAILS`         | بريدك الإلكتروني (ستصبح مدير المنصة تلقائيًا) |
     | `APP_TIMEZONE`                  | مثل `Asia/Gaza`                               |

| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar` |
| `EXPORT_RATE_LIMIT` | `5` (exports per user/project window) |
| `EXPORT_RATE_WINDOW_SECONDS` | `60` |

4. اضغط **Deploy** وانتظر حتى ينتهي البناء (2–3 دقائق تقريبًا).
5. انسخ رابط التطبيق، مثل `https://research-team.vercel.app`، ثم:
   - أضف المتغير `NEXT_PUBLIC_SITE_URL` بهذا الرابط من **Settings ← Environment Variables**.
   - أعد النشر: **Deployments ← ⋯ ← Redeploy**؛ قيم `NEXT_PUBLIC_*` تُضمَّن وقت البناء.

يمكنك تغيير اسم المشروع في **Settings ← General** للحصول على رابط أوضح، ثم تحديث
`NEXT_PUBLIC_SITE_URL` وإعادة النشر.

## 5. ربط تسجيل الدخول بالرابط

في Supabase ← **Authentication**:

1. **URL Configuration**
   - **Site URL:** رابط تطبيقك على Vercel.
   - **Redirect URLs:** أضف `https://<رابطك>.vercel.app/**`.
2. **Emails ← Templates:** لكل قالب الصق الموضوع والمحتوى من المجلد
   `supabase/templates`:

   | القالب في Supabase   | الملف               | الموضوع (Subject)                                                         |
   | -------------------- | ------------------- | ------------------------------------------------------------------------- |
   | Confirm sign up      | `confirmation.html` | `Confirm your account \| تأكيد الحساب`                                    |
   | Invite user          | `invite.html`       | `You have been invited to a research team \| دعوة للانضمام إلى فريق بحثي` |
   | Reset password       | `recovery.html`     | `Reset your password \| إعادة تعيين كلمة المرور`                          |
   | Change email address | `email_change.html` | `Confirm your new e-mail \| تأكيد البريد الإلكتروني الجديد`               |

## 6. إرسال البريد مجانًا (SMTP)

خدمة البريد المدمجة في خطة Supabase المجانية تُرسل فقط إلى عناوين أعضاء فريقك داخل
Supabase، وبعدد محدود جدًا من الرسائل في الساعة. لكي تصل رسائل التأكيد والدعوات لأعضاء فريقك
البحثي، فعّل SMTP مخصّصًا. أسهل خيار مجاني هو Gmail:

1. في حساب Google: **Security** ← فعّل **2-Step Verification** ← **App passwords**، وأنشئ
   كلمة مرور تطبيق (16 حرفًا).
2. في Supabase ← **Authentication ← Emails ← SMTP Settings** ← **Enable Custom SMTP**:

   | الحقل        | القيمة            |
   | ------------ | ----------------- |
   | Sender email | بريدك على Gmail   |
   | Sender name  | `Research Team`   |
   | Host         | `smtp.gmail.com`  |
   | Port         | `465`             |
   | Username     | بريدك على Gmail   |
   | Password     | كلمة مرور التطبيق |

3. يمكنك رفع حد الرسائل من **Authentication ← Rate Limits** (Gmail يسمح بنحو 500 رسالة يوميًا).

بدائل: Brevo (خطة مجانية)، أو Resend إن كان لديك نطاق (domain) خاص.

**إن لم تفعّل SMTP الآن:** يمكنك إيقاف **Confirm email** من
**Authentication ← Sign In / Providers ← Email** لتعمل التسجيلات فورًا. في هذه الحالة:

- أنشئ حساب المدير بنفسك مباشرة بعد النشر وقبل مشاركة الرابط؛ وإلا قد يسجّل شخص آخر ببريدك
  المذكور في `PLATFORM_ADMIN_EMAILS` قبلك.
- لن تعمل الدعوات ولا استعادة كلمة المرور إلا بعد إعداد SMTP.
- المستخدم الجديد لا يرى أي مشروع حتى يضيفه مالك المشروع.

## 7. أول استخدام

1. افتح رابط التطبيق ← **إنشاء حساب** بالبريد الذي وضعته في `PLATFORM_ADMIN_EMAILS`.
2. أكّد بريدك من الرسالة. ستصبح مدير المنصة تلقائيًا، ويظهر لك زر **مشروع جديد**.
3. أنشئ مشروعًا، ثم أضف فريقك من **الفريق ← إضافة عضو**:
   - إن كان للشخص حساب: يُضاف مباشرة.
   - إن لم يكن له حساب: تصله دعوة بالبريد (تتطلب SMTP).
4. اضبط صلاحيات كل عضو من **الفريق ← العضو ← الصلاحيات**.
5. (مستحسن) بعد أن تصبح مديرًا احذف `PLATFORM_ADMIN_EMAILS` من Vercel وأعد النشر؛ إدارة
   المديرين متاحة من **الإعدادات ← إدارة المنصة**.

لا تشغّل بيانات `npm run seed` التجريبية على نسخة الإنتاج؛ فهي مخصصة للتجربة المحلية.

## حدود الخطط المجانية (تقريبية، وقد تتغير)

- **Supabase Free:**
  - يتوقف المشروع مؤقتًا بعد أسبوع من عدم الاستخدام؛ تعيد تشغيله من اللوحة بضغطة، وتبقى
    البيانات محفوظة.
  - قاعدة بيانات حتى 500 MB، وتخزين ملفات حتى 1 GB، وحجم الملف الواحد حتى 50 MB.
- **Vercel Hobby:** للاستخدام الشخصي وغير التجاري؛ للمؤسسات أو الاستخدام التجاري تلزم خطة Pro.

## التحديثات لاحقًا

- أي دفع (push) إلى `main` يعيد النشر على Vercel تلقائيًا.
- عند وجود ترحيلات جديدة في `supabase/migrations`: `npx supabase link` ثم `npx supabase db push`
  (أو نفّذ ملفات الترحيل الجديدة بالترتيب في SQL Editor).
- ترقية NestHire (جدولة المهام وسير التنفيذ): طبّق ملفات `20261007000100…000500` بالترتيب **مع**
  نشر الكود الجديد، ثم نفّذ مرة واحدة `scripts/sql/nesthire-team.sql` لإنشاء فريق NestHire
  بأعضائه التسعة ورموزهم (انظر [NESTHIRE.md](NESTHIRE.md)).
- لتجنب إعادة البناء عند تعديل ملفات خارج المشروع (مثل README الحساب الشخصي): في Vercel ←
  **Settings ← Git ← Ignored Build Step** ضع الأمر `git diff --quiet HEAD^ HEAD -- .`

## حل المشكلات

| المشكلة                                                             | السبب والحل                                                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| النشر «Ready» لكن الموقع فارغ أو يعرض 404، والبناء استغرق ثوانٍ فقط | لم يُضبط **Root Directory**: في Vercel ← **Settings ← Build and Deployment** (أو **General**) ← **Root Directory** ← `research-team-platform` ← **Save**، ثم **Redeploy**. |
| ظهر مشروعان على Vercel لنفس المستودع                                | استورِدتَ المستودع مرتين؛ احذف أحدهما من **Settings ← General ← Delete Project** حتى لا يُبنى التطبيق مرتين.                                                               |
| رسالة «Supabase is not configured» أو صفحة خطأ عامة                 | متغيرات Supabase ناقصة أو خاطئة في Vercel؛ صحّحها ثم **Redeploy**.                                                                                                         |
| رابط التأكيد يعيدك إلى صفحة الدخول مع خطأ                           | الرابط استُخدم أو انتهت صلاحيته، أو **Site URL / Redirect URLs** غير مضبوطة (الخطوة 5).                                                                                    |
| الرسائل لا تصل                                                      | فعّل SMTP (الخطوة 6)، وافحص مجلد الرسائل غير المرغوب فيها.                                                                                                                 |
| «دعوة مستخدمين جدد غير مهيأة على الخادم»                            | أضف `SUPABASE_SERVICE_ROLE_KEY` في Vercel ثم أعد النشر.                                                                                                                    |
| لا يظهر زر «مشروع جديد»                                             | لست مدير منصة: تأكد أن بريدك مكتوب كما هو في `PLATFORM_ADMIN_EMAILS` وأنك أكّدته، ثم حدّث الصفحة.                                                                          |
| التطبيق متوقف بعد فترة                                              | مشروع Supabase المجاني توقف لعدم الاستخدام؛ أعد تشغيله من لوحة Supabase.                                                                                                   |
