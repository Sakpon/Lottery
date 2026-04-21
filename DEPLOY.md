# คู่มือการ Deploy

## วิธีเร็วที่สุด: One-click bootstrap via GitHub Actions ⚡

**ใช้เมื่อคุณตั้งค่า GitHub secrets `CLOUDFLARE_API_TOKEN` และ `CLOUDFLARE_ACCOUNT_ID` แล้ว**

### ขั้นตอน

1. **Merge PR** หรือ push เข้า `main` เพื่อให้ workflow ใช้ได้
2. ไปที่ GitHub → **Actions** → **Bootstrap (one-click setup)** → **Run workflow**
   - จะสร้าง D1 database, apply schema, สร้าง Pages project, deploy ทุกอย่าง
3. เมื่อ bootstrap เสร็จ ดู "Summary" ของ workflow — จะบอก URL ของ API Worker และขั้นตอนถัดไป
4. **ตั้ง Scraper ADMIN_TOKEN** (ในเครื่องคุณ):
   ```bash
   npx wrangler secret put ADMIN_TOKEN --config workers/scraper/wrangler.toml
   ```
   (พิมพ์ token ที่สุ่ม/ตั้งเอง)
5. **เพิ่ม GitHub secrets**:
   - `SCRAPER_URL` = URL ของ scraper worker (เช่น `https://lottery-th-scraper.YOUR_SUBDOMAIN.workers.dev`)
   - `SCRAPER_ADMIN_TOKEN` = ค่าเดียวกับข้อ 4
6. **เพิ่ม Pages env var** ที่ Cloudflare Dashboard → Pages → `lottery-th` → Settings → Environment variables:
   - `API_BASE` = URL ของ API Worker
7. ไปที่ Actions → **Backfill lottery history** → Run workflow (เลือก years=20)
   - รอ 5-10 นาที ระบบจะดึงข้อมูลผลสลากย้อนหลัง 20 ปีจาก sanook.com
8. เสร็จ! เข้าที่ Pages URL ดูผล

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
| `CLOUDFLARE_API_TOKEN`  | Bootstrap, Deploy Workers, Deploy Pages      | Cloudflare Dashboard → API Tokens  |
| `CLOUDFLARE_ACCOUNT_ID` | Bootstrap, Deploy Workers, Deploy Pages      | Dashboard URL หรือ sidebar         |
| `SCRAPER_URL`           | Backfill workflow                            | URL ของ scraper worker             |
| `SCRAPER_ADMIN_TOKEN`   | Backfill workflow                            | ตั้งเองแล้วใช้ `wrangler secret put ADMIN_TOKEN` ในฝั่ง worker ด้วย |

## สิทธิ์ที่ API Token ต้องมี

สร้าง API token แบบ Custom ที่ Cloudflare Dashboard → My Profile → API Tokens → Create Token:

- Account → **Workers Scripts** → Edit
- Account → **D1** → Edit
- Account → **Cloudflare Pages** → Edit
- Account → **Account Settings** → Read
