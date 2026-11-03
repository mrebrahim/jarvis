# JARVIS

مساعد صوتي بالعامية المصرية بيجمع شغل الوكالة والكورسات والسوشيال في مكان واحد.
الـ PRD الكامل في [`docs/PRD.md`](docs/PRD.md).

## اللي في الريبو ده (الـ MVP — قراية وتقارير بس)

| الجزء | المكان | بيغطي |
|---|---|---|
| Supabase schema + RLS + pg_cron + Realtime | `supabase/migrations/` | كل جداول نموذج البيانات، `today_overview()`، `sales_outreach()`، الموافقات، زرار الطوارئ |
| لوحة التحكم (Next.js, RTL) | `dashboard/` | D-1 شاشة النهارده لايف، D-2 المايك، D-3 الموافقات وسجل الأدوات، D-4 الـ kill switch |
| JARVIS Live (Gemini Live) | `dashboard/lib/live`, `dashboard/lib/jarvis` | V-1، V-2 (barge-in + echo guard + noise gate)، أدوات قراية بس |
| مواصفات workflows الـ n8n | `n8n/README.md` | W-1، W-2، C-1، T-1، R-1، المراقبة، منفّذ الموافقات |

## إزاي الأمان متطبّق

- **مفتاح Gemini مابيوصلش المتصفح.** السيرفر بيطلع ephemeral token لاستخدام واحد، والـ system prompt والأدوات مقفولين جوّه التوكن، فالمتصفح مايقدرش يغيّرهم.
- **الأدوات كلها مستوى 0 (قراية).** مفيش أداة بتبعت أو بتعدّل، فأي "بعت/عملت" في كلام JARVIS بيتسجل كـ `events.type = 'honesty_violation'`.
- **الأدوات بتقرا بصلاحية إبراهيم** (RLS)، والـ service role بيُستخدم بس لكتابة سجل `tool_calls` و `events`، ومابيخرجش برّه السيرفر.
- **زرار الطوارئ** بيقفل توكنات اللايف الجديدة، وبيمنع أي tool call، وبيقفل المايك المفتوح، وبيرفض كل الموافقات المستنية أو اللي اتوافق عليها ولسه ماتنفذتش. كل workflow في n8n بيشيك عليه الأول.
- **الموافقات** بتنتهي بعد 10 دقايق (pg_cron كل دقيقة)، والموافقة مابتنفذش حاجة بنفسها: n8n بينفذ بتوكن الكتابة بعد ما تتأكد.
- **RLS مفعّل على كل الجداول.** القراية لـ `is_owner()` بس، والكتابة من الداشبورد بتعدّي من functions محددة (`decide_approval`، `set_agents_enabled`).

## التشغيل

### 1. Supabase

```bash
supabase link --project-ref <ref>
```

```bash
supabase db push
```

بعد كده عدّل `supabase/seed.sql` بالأرقام والأسامي الحقيقية وشغّله. من Authentication في Supabase اعمل invite لإيميل إبراهيم (الدخول بالـ magic link مقفول على اليوزرز الموجودين بس)، وبعد أول دخول:

```sql
insert into public.app_owners (user_id) select id from auth.users where email = '<email>';
```

### 2. الداشبورد

```bash
cd dashboard && cp .env.example .env.local
```

املا `.env.local` (بمفتاح Gemini **جديد**، مش اللي اتكتب في الشات)، وبعدين:

```bash
npm install && npm run dev
```

للنشر على Coolify استخدم `dashboard/Dockerfile` (ابعت `NEXT_PUBLIC_*` كـ build args). المايك محتاج HTTPS (Cloudflare Tunnel كفاية).

### 3. n8n

ابني الـ workflows حسب `n8n/README.md`. أهمها للـ MVP: 10 و 20 و 30 و 40 و 60.

## اللي اتأكد منه

- `npm run typecheck` و `next build` بيعدّوا.
- الـ migration اتطبق على Postgres (PGlite + pgvector) مع stubs لـ `auth` و `pg_cron`، واتجرّب عليه: `today_overview()` بداتا تجريبية، وحساب رد/ماردش في `sales_outreach()`، وانتهاء الموافقات، ورفض الموافقة مرتين، والـ kill switch، ومنع غير المالك.
- **ماتجرّبش:** اتصال Gemini Live حقيقي، و Supabase Cloud حقيقي (RLS و Realtime)، و workflows الـ n8n (لسه مواصفات بس).

## قبل الإنتاج (من الـ PRD)

- اسم موديل اللايف بالظبط في `GEMINI_LIVE_MODEL` (اللي نجح في اختبار 3 نوفمبر).
- الأسئلة المفتوحة في آخر `docs/PRD.md`، وخصوصًا: ميعاد التقرير وقناته، وأسامي فريق السيلز، وإيه اللي بيتحسب "شغل".
- بلّغ الفريق بالمؤشرات اللي بتتقاس قبل تشغيل workflow 40.
