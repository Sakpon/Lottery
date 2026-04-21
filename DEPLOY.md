# คู่มือการ Deploy

## สิ่งที่ต้องมี

- บัญชี [Cloudflare](https://cash.cloudflare.com/sign-up) (ฟรี)
- บัญชี GitHub + repository นี้
- Node.js ≥ 20
- `npm install` ที่ root

## 1) สร้าง D1 Database

```bash
npx wrangler login
npx wrangler d1 create lottery_th
```

คัดลอก `database_id` ที่ได้ แล้วแทนที่ `REPLACE_WITH_D1_ID` ในไฟล์
- `workers/api/wrangler.toml`
- `workers/scraper/wrangler.toml`

สร้าง schema:

```bash
npm run db:init
```

## 2) ตั้งค่า secrets สำหรับ Scraper

```bash
# สำหรับ POST /backfill, /fetch
npx wrangler secret put ADMIN_TOKEN --config workers/scraper/wrangler.toml
```

## 3) Deploy Workers

```bash
npm run deploy:api
npm run deploy:scraper
```

## 4) Backfill ข้อมูลย้อนหลัง 20 ปี (one-time)

```bash
curl -X POST "https://lottery-th-scraper.<YOUR_SUBDOMAIN>.workers.dev/backfill?years=20" \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

> การ backfill 20 ปี ≈ 480 งวด อาจใช้เวลา 5-10 นาที
> Worker จะ throttle คำขอไปยัง sanook.com เพื่อเป็นมารยาทต่อ host
> สามารถรันซ้ำได้ ระบบจะข้ามงวดที่มีอยู่แล้ว

## 5) Deploy Cloudflare Pages

สร้าง Pages project ชื่อ `lottery-th` — ต่อเข้ากับ GitHub repository นี้
ตั้งค่าใน Pages → Settings → Environment variables:

- `API_BASE` = `https://lottery-th-api.<YOUR_SUBDOMAIN>.workers.dev`

หรือ deploy ผ่าน CLI:

```bash
npm run deploy:web
```

## 6) ตั้งค่า GitHub Actions (deployed on push)

เพิ่ม secrets ใน GitHub repo:
- `CLOUDFLARE_API_TOKEN` — สร้างที่ Cloudflare Dashboard → My Profile → API Tokens
  (ต้องมีสิทธิ์ Workers Scripts:Edit, D1:Edit, Pages:Edit)
- `CLOUDFLARE_ACCOUNT_ID` — อยู่ที่ Dashboard URL

เมื่อ push ไป `main` จะ deploy อัตโนมัติ

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
