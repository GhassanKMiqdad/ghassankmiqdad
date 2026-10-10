# NestHire Workspace — تقرير تجهيز مشروع Supabase الجديد

**التاريخ:** 2026-10-10  
**المستودع:** `GhassanKMiqdad/ghassankmiqdad`  
**مرجع الكود:** `origin/main` — `d923fe204a2b5bcbbcac7c29b251bc8a1fe8953f`  
**مشروع Supabase الهدف:** `jkvxhxrclfvoxqcniyck`  
**اسم المشروع:** `NestHire Production`  
**المنطقة:** `ap-southeast-1`

## نتيجة التحقق من المشروع الهدف

- حالة المشروع: `ACTIVE_HEALTHY`.
- سجل Supabase migrations قبل التنفيذ: **فارغ** (`migrations: []`).
- جداول التطبيق في schema `public`: لا توجد جداول تطبيقية.
- جداول Storage الداخلية موجودة بحالتها الافتراضية؛ `storage.buckets` و`storage.objects` فارغان.
- لم يُستخدم المعرّف القديم `vqorfahkecswjrqgizhy`.

## migrations الموجودة في main وترتيبها

تم فحص الملفات من `origin/main`، وعددها **19 migration** مرتبة زمنيًا كما يلي:

1. `20261001000100_core_schema.sql`
2. `20261001000200_permission_catalog.sql`
3. `20261001000300_helper_functions.sql`
4. `20261001000400_auth_profiles.sql`
5. `20261001000500_business_rules.sql`
6. `20261001000600_audit_log.sql`
7. `20261001000700_rpc_functions.sql`
8. `20261001000800_row_level_security.sql`
9. `20261001000900_storage.sql`
10. `20261007000100_nesthire_roles_teams.sql`
11. `20261007000200_nesthire_task_model.sql`
12. `20261007000300_nesthire_task_rules.sql`
13. `20261007000400_nesthire_workflow.sql`
14. `20261007000500_nesthire_security.sql`
15. `20261008000100_workflow_security_hardening.sql`
16. `20261008000200_final_privacy_hardening.sql`
17. `20261008000300_strict_external_links.sql`
18. `20261009000100_export_rate_limit.sql`
19. `20261010000100_nesthire_manager_self_review.sql`

الترتيب يضع المخطط والـhelpers والـRPC والصلاحيات قبل طبقة NestHire، ثم hardening والخصوصية والروابط الخارجية وRate Limiting واستثناء مراجعة المدير.

## الاختبار المحلي

تم تشغيل:

```text
npm run test:db:local
```

النتيجة الفعلية:

```text
All tests successful.
Files=11, Tests=387, Result: PASS
```

طبّق الاختبار المحلي migrations التسع عشرة على PostgreSQL معزول وشغّل اختبارات pgTAP الخاصة بالمخطط والصلاحيات والخصوصية وStorage وRate Limiting وسير عمل NestHire.

هذا الدليل **محلي فقط** ولا يثبت تطبيق أي migration على Supabase السحابي.

## المصادقة ومحاولة العرض الجاف السحابي

- تم تسجيل الدخول بنجاح إلى Supabase CLI عبر المسار الرسمي باستخدام Access Token مقدم من المستخدم؛ لم تُطبع قيمة الرمز في السجل.
- تم ربط CLI بالمشروع `jkvxhxrclfvoxqcniyck` بنجاح (`supabase link`).
- تم تشغيل:

```text
npx supabase@2.119.0 db push --dry-run --project-ref jkvxhxrclfvoxqcniyck
```

- فشل `dry-run` قبل قراءة سجل migrations بسبب قيود الشبكة الحالية على IPv6، حتى بعد إعادة الربط ومحاولة `--dns-resolver https`:

```text
IPv6 is not supported on your current network
Run supabase link --project-ref jkvxhxrclfvoxqcniyck to setup IPv4 connection.
```

- لا توجد قائمة migrations سحابية قابلة للإثبات بعد؛ لذلك لم يتم الانتقال إلى `db push` ولم تتم أي كتابة.


## ما تم تطبيقه فعليًا على المشروع الجديد

**لا شيء.**

لم يتم تنفيذ:

- `supabase db push`.
- `supabase db reset --linked`.
- Seed تجريبي.
- حذف أو تعديل بيانات.
- أي تغيير في إعدادات الإنتاج.

## العائق المطلوب حله

يلزم توفير مسار اتصال PostgreSQL IPv4 صالح من بيئة التنفيذ (عادةً connection string للـpooler من لوحة Supabase أو بيئة CI مسموح لها بالاتصال)، لأن المصادقة والربط نجحا لكن اتصال قاعدة البيانات المباشر محجوب.

```text
supabase db push --db-url <IPv4 pooler URL> --dry-run
```

يجب الحصول على كلمة مرور قاعدة البيانات/رابط pooler عبر إدارة Supabase الرسمية أو Secret Manager، لا عبر المحادثة. بعد توفر مسار الاتصال سيُعاد تنفيذ الخطوات بالترتيب:

1. `supabase db push --project-ref jkvxhxrclfvoxqcniyck --dry-run`.
2. مراجعة القائمة الناتجة والتأكد من أنها migrations التسع عشرة فقط.
3. `supabase db push --project-ref jkvxhxrclfvoxqcniyck` دون `--include-seed` ودون `db reset`.
4. إعادة قراءة سجل migrations والمخطط والجداول والدوال والسياسات والفهارس وRLS وStorage.
5. تشغيل اختبارات الصلاحيات والخصوصية وRate Limiting المناسبة على المشروع الجديد.

**الحالة:** جاهزية الكود والمخطط المحلي مثبتة، والمشروع الجديد تم التحقق من هويته وربطه؛ تطبيق Supabase السحابي **لم يبدأ** لأن اتصال PostgreSQL IPv4 لم يتوفر. لا توجد migrations مطبقة فعليًا.

## تحديث التنفيذ الفعلي — 2026-10-10

- الاختبار المحلي النهائي: **389 اختبارًا ناجحًا من 11 ملفًا**.
- بسبب حجب اتصال CLI المباشر بـIPv6، استُخدم مسار Supabase الرسمي عبر MCP بعد التحقق من المشروع الجديد.
- سجل Supabase الفعلي بعد التنفيذ الجزئي:
  - `core_schema`
  - `core_schema_regex_fix`
  - `core_schema_regex_fix_v2`
  - `permission_catalog`
  - `revoke_rls_auto_enable_execute`
- لم تُطبق السلسلة الرسمية كاملة؛ migrations من `helper_functions` فصاعدًا غير مطبقة.
- لم تُستخدم `db reset --linked` ولم يُطبق Seed ولم تُحذف بيانات تطبيقية.
- يلزم الآن Session Pooler — Session Mode عبر Secret Manager/CI باسم `SUPABASE_DB_URL` حتى يمكن تنفيذ `dry-run` و`db push` الرسميين دون تحويل SQL يدويًا.
- **Production Readiness: NO-GO** إلى أن يكتمل سجل migrations الرسمي وتُراجع الجداول والدوال والسياسات وStorage على القاعدة السحابية.
