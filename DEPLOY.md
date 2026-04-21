# คู่มือการ Deploy

## วิธีเร็วที่สุด: One-click bootstrap via GitHub Actions ⚡

**ต้องมี GitHub secrets 2 ตัวเท่านั้น** — `CLOUDFLARE_API_TOKEN` และ `CLOUDFLARE_ACCOUNT_ID`
(ส่วนอื่น ๆ เช่น ADMIN_TOKEN, API_BASE env var, etc. workflow จะจัดการให้อัตโนมัติ)

### ขั้นตอน (2 คลิก)

1. **Merge PR** เข้า `main` เพื่อให้ workflow พร้อมใช้
2. ไปที่ GitHub → **Actions** → **Bootstrap (one-click full deploy + backfill)** → **Run workflow**
   - ใส่ `backfill_years = 20` แล้วกด Run
   - Workflow จะทำให้ครบทุกขั้นอัตโนมัติ:
     - สร้าง D1 database + apply schema
     - Deploy API + Scraper Workers
     - สุ่มและตั้ง `ADMIN_TOKEN` สำหรับ Scraper (masked ใน log)
     - สร้าง Pages project + ตั้ง `API_BASE` env var ผ่าน CF API
     - Deploy Pages
     - รัน backfill 20 ปี (5–10 นาที)
   - รวมเวลา: ~10–15 นาที
3. เปิด URL ของ Pages จาก Summary ของ workflow — พร้อมใช้งาน 🎉

**ไม่ต้องทำอะไรเพิ่ม** — cron จะอัปเดตเองทุกวันที่ 2 และ 17 ของเดือน
หากต้องการ re-backfill ภายหลัง ให้รัน workflow **Backfill lottery history**

---

## Manual deployment (วิธีดั้งเดิม)

### สิ่งที่ต้องมี

- บัญชี [Cloudflare](https://dash.cloudflare.com/sign-up) (ฟรี)
- Node.js ≥ 20
- `npm install` ที่ root

### 1) ล็อกอิน Wrangler

```bash
npx wrangler login
```

### 2) สร้าง D1 Database

```bash
npx wrangler d1 create lottery_th
```

คัดลอก `database_id` ที่ได้ แล้วแทนที่ `REPLACE_WITH_D1_ID` ในไฟล์
- `workers/api/wrangler.toml`
- `workers/scraper/wrangler.toml`

### 3) Apply schema

```bash
npm run db:init
```

### 4) Set secrets

```bash
npx wrangler secret put ADMIN_TOKEN --config workers/scraper/wrangler.toml
```

### 5) Deploy

```bash
npm run deploy:api
npm run deploy:scraper
npm run deploy:web
```

### 6) Backfill 20 ปี

```bash
curl -X POST "https://lottery-th-scraper.<YOUR_SUBDOMAIN>.workers.dev/backfill?years=20" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

> การ backfill 20 ปี ≈ 480 งวด อาจใช้เวลา 5-10 นาที
> Worker จะ throttle คำขอไปยัง sanook.com เพื่อเป็นมารยาทต่อ host
> สามารถรันซ้ำได้ ระบบจะข้ามงวดที่มีอยู่แล้ว

---

## ตรวจสอบการทำงาน

```bash
# Status ของ scraper
curl https://lottery-th-scraper.<YOUR_SUBDOMAIN>.workers.dev/status \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# ทดสอบ API
curl https://lottery-th-api.<YOUR_SUBDOMAIN>.workers.dev/api/draws/latest
curl https://lottery-th-api.<YOUR_SUBDOMAIN>.workers.dev/api/stats/last_two?window=60
curl https://lottery-th-api.<YOUR_SUBDOMAIN>.workers.dev/api/predict/last_two?topK=10
```

## Local development

```bash
# ติดตั้ง deps
npm install

# รัน API worker (ต้อง seed ข้อมูลก่อน)
npm run db:init:local
npm run seed:local
npm run dev:api

# รัน scraper (ทดสอบ cron)
npm run dev:scraper

# รัน Pages
npm run dev:web
```

## GitHub secrets ที่ต้องตั้ง

| Secret                  | ใช้ที่ไหน                                    | ได้จากไหน                          |
|-------------------------|----------------------------------------------|------------------------------------|
| `CLOUDFLARE_API_TOKEN`  | ทุก workflow                                 | Cloudflare Dashboard → API Tokens  |
| `CLOUDFLARE_ACCOUNT_ID` | ทุก workflow                                 | Dashboard URL หรือ sidebar         |

> `ADMIN_TOKEN` ของ Scraper จะถูก rotate อัตโนมัติในแต่ละครั้งที่รัน Bootstrap หรือ Backfill workflow
> ไม่ต้องเก็บเป็น GitHub secret

## สิทธิ์ที่ API Token ต้องมี

สร้าง API token แบบ Custom ที่ Cloudflare Dashboard → My Profile → API Tokens → Create Token:

- Account → **Workers Scripts** → Edit
- Account → **D1** → Edit
- Account → **Cloudflare Pages** → Edit
- Account → **Account Settings** → Read
