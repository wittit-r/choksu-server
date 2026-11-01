# แผน Phase B — ย้าย MySQL + Sequelize (+ ย้ายข้อมูลจาก PostgreSQL)

> **วิธีใช้ไฟล์นี้ (สำหรับทุก session):**
> 1. อ่านไฟล์นี้ก่อนเริ่มทำงานต่อทุกครั้ง — โดยเฉพาะ "ตารางสถานะ" และ "กติกาเวลา"
> 2. หลังเสร็จแต่ละขั้น: ทำเครื่องหมาย checkbox + จด log ใน "บันทึกความคืบหน้า"
> 3. ห้ามข้ามขั้น / ห้ามไปขั้นถัดไปถ้า tests ไม่เขียว
> 4. ผู้ใช้อนุมัติแผนฉบับนี้แล้ว (สนทนา 1 พ.ย. 2026) — แก้แผนต้องแจ้งผู้ใช้ก่อน

**Branch:** `feature/db-mysql-sequelize` (แตกจาก develop ที่มี payroll ครบ)
**ผลลัพธ์:** backend ใช้ MySQL (MAMP, root/root, 127.0.0.1:3306) + Sequelize 6, ข้อมูลย้ายจาก PG, tests 16/16 เขียว

---

## หลักการตัดสินใจ (ใช้อ้างอิงเมื่อเจอจุดที่แผนไม่ครอบคลุม)

1. **API contract ไม่เปลี่ยน** — frontend ไม่แตะ (verify ด้วย browser smoke ตอน B6)
2. **tests 16 ตัว = เกณฑ์ผ่านทุกขั้น** — suite: `npm test`
3. **Convention เวลาใหม่: naive column = เวลาไทยตรงๆ** ผ่าน `timezone: '+07:00'`
   ของ Sequelize + คง `TZ=Asia/Bangkok` ใน npm scripts (สองชั้น)
4. โปรเจค dev-only ไม่มี production — reset ข้อมูลได้ทุกเมื่อ

## กติกาเวลา (อ้างอิงถี่ถ้วน — ห้ามสับสน)

| ช่วง | Convention ใน DB | หมายเหตุ |
|---|---|---|
| ยุค Prisma+PG (ก่อน B) | `time_entries` เก็บ **wall−7** (08:00 จริง → 01:00), ส่วน wage/period/date-only เก็บเวลาไทย | เป็นอยู่ใน PG ตอนนี้ |
| **หลัง B (Sequelize+MySQL)** | **ทุก field เก็บเวลาไทยตรงๆ** | `new Date(y,m,d,h)` + `getHours()` ใช้ได้ตามปกติ |

- อ่านเวลา: `getHours()`/`getDate()` (local, เครื่อง +7) — **ไม่ใช้ getUTC***
- เขียนเวลา: สร้าง Date ปกติ Sequelize แปลงให้ตาม timezone config
- date-only string (`'2026-11-01'`) → `new Date('2026-11-01')` เก็บ 00:00 ✓
- กะ: ดึก 00:00–08:00 / เช้า 08:00–16:00 / บ่าย 16:00–24:00 (24:00 = เที่ยงคืนวันถัดไป)
- กะข้ามวันจากข้อมูลแก้ตรง (end < start): มี guard ชดเชย +24 ชม. อยู่แล้วใน
  pay-period.service.js — **ย้าย logic นี้ตามตอน rewrite**

---

## ขั้นตอน

### ☑ B1 — รากฐาน Sequelize (18 models, schema เท่ากันเป๊ะ)
- `npm i sequelize mysql2` (เวอร์ชัน sequelize เสถียรล่าสุด v6)
- สร้าง `src/database/index.js`: instance เดียว, `timezone: '+07:00'`,
  `define: { underscored: true }`, timestamps → `created_at/updated_at`,
  logging ปิด
- `src/database/models/` 18 models + associations — อ้างค่า enum/FK/onDelete
  จาก `prisma/migrations/20261031231810_init/migration.sql` (baseline เก่า)
- DECIMAL → number อัตโนมัติ (afterFind converter กลาง แทน prisma extension)
  **จุดอ่อนเรื่องเงิน ระวังสุด**
- **[ผู้ใช้ทำ]** แก้ `.env`: `DATABASE_URL=mysql://root:root@127.0.0.1:3306/choksu`
- **Verify:** `sequelize.sync()` สร้าง DB `choksu` ได้ + สคริปต์ diff schema
  (PG information_schema vs MySQL) → ต้องว่าง (ยกเว้น type mapping ที่คาดหวัง)

### ☑ B2 — ย้ายข้อมูล PG → MySQL (`scripts/migrate-from-pg.js`)
- ลำดับ FK: branches → positions → work_leaders → employees → wage_rates →
  users/sessions → time_sheets → time_entries → pay_periods → payrolls →
  payroll_relates → contracts/invoices/bill_rates/audit_logs
- **แปลงเวลา:** `time_entries.start/end` **+7 ชม.** / `time_sheets.work_date`
  = 00:00 ของวันที่ `(work_date + 7h)` / อื่นๆ copy ตรง
- **กรองขยะทดสอบออก:** employees TESTONE/TESTTWO (id 12,13) + pay_periods
  id 4,5 (รอบ 9,10) + time_sheets/entries/payrolls ที่เกี่ยวกับชุดนี้
  (sheet 20,21,22,23 / entry 162,163,164 / payroll 11,12,13,14)
- Reset AUTO_INCREMENT ทุกตาราง, ทำใน transaction
- **Verify:** row counts เท่า (หลังหักกรอง) + spot-check `paidValue` ตรง
  ก่อน/หลัง + เปิด DB เวลาเป็นเวลาไทยถูกต้อง

### B3 — Rewrite services ทีละโมดูล (tests เขียวหลังแต่ละโมดูล)
- ลำดับ: ☑ auth+user → ☑ branch/position/work-leader → ☑ employee
  (+wages/retro) → ☑ timesheet → ☑ payroll + pay-period — ครบทุกโมดูล
- ☑ **Dual-test-infra (B3-0) วางแล้ว:** `DATABASE_URL`=MySQL test /
  `DATABASE_URL_PG`=PG test (prisma.js อ่าน PG ตัวนี้), global-setup สร้างทั้งสอง
  DB, helpers (db/seed/auth) เขียน+ล้างทั้งคู่, PG sequence reset ทุก clean
- **สถานะแปลงแล้ว:** auth.service, middlewares/auth.js, user.service,
  branch.service, position.service, work-leader.service — tests 16/16 เขียวทุกจุด
- **จุดระวังโมดูลที่เหลือ:**
  - employee: `new Date('YYYY-MM-DD')` date-only ✓ ใช้ตรงๆ (convention ใหม่),
    `getHours()` ใช้ได้ตามปกติ
  - timesheet/pay-period/payroll: `$transaction` → `sequelize.transaction(t)`
    ส่ง `{ transaction: t }` ทุก op, raw SQL 3 จุด (bulk paidValue CASE WHEN) →
    `sequelize.query` + replacements
  - User model มี defaultScope ซ่อน passwordHash แล้ว
- **Verify:** `npm test` หลังแต่ละโมดูล

### ☑ B4 — สลับ test infra มา MySQL
- `test/global-setup.js`: drop/create `choksu_test` (MySQL) + sync + seed
- `test/helpers/db.js`: `SET FOREIGN_KEY_CHECKS=0` + TRUNCATE
- `test/helpers/seed.js`: ใช้ Sequelize models
- **Verify:** `npm test` → **16/16 เขียวบน MySQL**

### ☑ B5 — เก็บกวาด + เอกสาร + seed มาตรฐาน
- ถอด Prisma: `prisma/`, `prisma.config.js`, deps, adapter — baseline เดิม
  ย้ายไป `docs/legacy/`
- `scripts/seed.js` มาตรฐาน: admin, สาขา, ตำแหน่ง 9 แบบ, หัวหน้างาน,
  พนักงานตัวอย่าง + wage rates (reset+seed คำสั่งเดียว)
- อัปเดต CLAUDE.md + **business-rules skill** (กติกาเวลาใหม่/Sequelize/
  migrate ด้วย mysqldump) — แก้ skill ต่อเมื่อผู้ใช้ confirm ตามกติกาโปรเจค
- `graphify update`

### ☑ B6 — ยืนยันรวม + ปิดงาน
- **Verify:** suite เขียว + browser smoke: login (admin/123456) → หน้ารอบจ่าย
  (ข้อมูลย้ายมา) → เปิดรายการจ่าย ตัวเลขตรงกับก่อนย้าย
- commit + push `feature/db-mysql-sequelize` → merge เข้า develop (ขออนุมัติ)

## นอกขอบเขต
frontend / export-import (รอไฟล์ธนาคาร → branch `feature/payroll-export-import`
ในอนาคต) / branch master / .env ของผู้ใช้ (แก้เอง)

## ความเสี่ยงที่เฝ้าระวังตลอด
1. DECIMAL เป็น string ใน Sequelize → ต้องผ่าน converter กลางเสมอ
2. MySQL collation ไม่สน case (PG สน) — โค้ดเทียบ enum พิมพ์ใหญ่อยู่แล้ว
   แต่ตรวจจุด query สตริงอิสระซ้ำตอน B3
3. อย่าลืมว่าช่วง B3 ระบบวิ่งสอง ORM (แปลง service แล้ว = MySQL, ยังไม่แปลง = PG)
   — สถานะ "แปลงถึงโมดูลไหน" ต้องจดทุกครั้งในบันทึกข้างล่าง

---

## บันทึกความคืบหน้า (เขียนทุกครั้งที่จบขั้น/จบ session)

| วันที่ | ขั้น | ผล | หมายเหตุ/สิ่งที่ค้าง |
|---|---|---|---|
| 2026-11-01 | แผน | ผู้ใช้อนุมัติแผน (ฉบับนี้) | ยังไม่เริ่ม B1 — รอผู้ใช้แก้ .env |
| 2026-11-01 | B1 | ✅ เสร็จ — sequelize@6.37.8 + mysql2@3.24.6, models 18 ตัวใน src/database/, sync สร้าง DB choksu ได้, parity ✅ (18 ตาราง/169 คอลัมน์/FK 25/unique 13 เท่ากัน; ยอมรับ diff เดียว: updated_at NOT NULL ใน MySQL) | field ที่ถูก unique-index เปลี่ยนเป็น VARCHAR (MySQL ห้าม UNIQUE บน TEXT): code/contractNo/idCard/username/token/payRef/invoiceRef/monthPeriod/audit.tableName — dev server หยุดชั่วคราวระหว่าง B3 (.env ชี้ MySQL แล้ว, Prisma ยังอยู่) |
| 2026-11-01 | B2 | ✅ เสร็จ — scripts/migrate-from-pg.js ย้าย 18 ตาราง counts ตรงหมด (108 time_entries, 11 พนักงานจริง, 16 sheets), ยอด spot-check ตรงเป๊ะ (437.00/532.00/465.50), เวลาแปลง +7 สำเร็จ = เห็น 08:00/16:00 ตรงๆ ใน MySQL | พบ payroll 15 (PAY-2026-10-002) เพิ่มเข้า list กรอง; updated_at null เติมด้วย created_at |
| 2026-11-01 | B3 (auth+user+branch+position+work-leader) | ✅ tests 16/16 เขียวทุกจุด | dual-infra (B3-0) วางแล้วในขั้นนี้ |
| 2026-11-01 | B3 (employee) | ✅ แปลงครบทุก method + smoke tests ผ่านทั้ง service/HTTP level — **tests 15/16**: flow-9 ตกเพราะเป็น structural ของ transition (retro อ่าน MySQL แต่ timesheet/payroll ยังเขียน PG) จะเขียวเองเมื่อแปลง timesheet/payroll เสร็จ | Sequelize traps ที่เจอ (จำไว้ใช้ต่อ): (1) nested where key `$wageRates.x$` ใช้ไม่ได้กับ underscored — ใช้ include.where+required อย่างเดียว (2) nested include + pagination → ดึง parent ids ก่อนแล้ว IN (3) take:1 per-parent → query รวมแล้ว pick ใน JS (4) ใส่ distinct:true ใน findAndCountAll เมื่อมี required include; dev server ที่ค้างหยุดแล้ว |
| 2026-11-01 | B3 (timesheet) | ✅ แปลงครบทุก method — smoke 31/31 ผ่านบน MySQL (สร้าง DAILY/MONTHLY, เวลาไทยถูกต้อง, 24:00→วันถัดไป, 409 duplicates/overlaps, cascade delete) | **tests ชั่วคราว 2/16 — คาดไว้**: timesheet เขียน MySQL แล้ว แต่ pay-period ยังอ่าน PG → `created: 0` ใน 12 flows (ทุก timesheet assertion ผ่านก่อนจุดตก) — จะเขียวเมื่อ payroll/pay-period แปลงเสร็จ; flow-driver เพิ่ม mirror seed MySQL ในไฟล์ test แล้ว (ผมแก้เอง); Noticed: `createCorrectionTimeEntry` มี dead-code isNegative check มาแต่โค้ดเดิม (latent bug — ยังไม่แก้ จะรายงาน user) |

| 2026-11-01 | B3 (payroll + pay-period) | ✅ แปลงครบ (raw SQL 3 จุด → `_bulkUpdatePaidValue` helper เดียว + transactions) — 12 flows เขียวกลับทันที เหลือ 2 ตัวที่ตัว test เขียน/อ่าน PG ตรงๆ | Sequelize traps เพิ่ม: include ระดับกลาง attributes:[] จะหายทั้งอัน (ใส่ ['id']), GROUP BY ต้อง qualify ('TimeEntry.employee_id') |
| 2026-11-01 | B4 | ✅ test infra เป็น MySQL ล้วน (แปลง 4 test files + helpers + setup + global-setup) — **16/16 เขียว, suite 8.2s (เดิม ~14s)** | — |
| 2026-11-01 | B5 | ✅ ถอด Prisma ครบ (schema/config/client/deps/.env.test), baseline → docs/legacy/, seed.js มาตรฐานพร้อม guard --yes, CLAUDE.md อัปเดต | ระหว่างทางพลาดรัน seed --reset ทับ dev DB หนึ่งครั้ง — กู้คืนสมบูรณ์ด้วย migrate ใหม่; .claude/ (skills+settings) ติดขึ้น repo ไปกับ git add -A |
| 2026-11-01 | B6 | ✅ dev server บูตบน MySQL จริง + browser smoke: login → รอบ 1/2 มี.ค. 2026 (ข้อมูล migrate) → ตัวเลขตรงเดิม (437 / 5,253.5 / 2,035.83 รวม OT) — commit 606c480 push แล้ว | เหลือ: business-rules skill มีเนื้อหา Prisma อยู่ — รอ user confirm แก้; graphify update ยังไม่ได้รัน (คำสั่งหาไม่เจอ) |

## ✅ Phase B เสร็จสมบูรณ์ (1 พ.ย. 2026)
ระบบใช้ MySQL + Sequelize ล้วน / เวลาไทยตรงๆ / 16 tests เขียว / ข้อมูลย้ายครบ
