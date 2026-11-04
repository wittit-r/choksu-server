# แผนล็อครอบจ่ายหลัง export + gate การแก้ไขรายการ CALCULATED

> **สถานะ: IN PROGRESS — เขียนแผนเสร็จ 4 พ.ย. 2026 เริ่ม execute**
> **Branch:** `feature/sso`
> **วิธีใช้:** checklist ขั้นตอนด้านล่าง + จด log ใน "บันทึกความคืบหน้า" ท้ายไฟล์
> **หลักการ:** dev-only / tests ต้องเขียวทั้งชุดทุกขั้น / กติกาเวลาตาม PHASE-B-PLAN.md (เวลาไทยตรงๆ)

---

## 1. กติกาธุรกิจที่ตกลงแล้ว (ห้ามเปลี่ยนโดยไม่แจ้งผู้ใช้)

| # | เรื่อง | ข้อสรุป |
|---|---|---|
| 1 | Export = finalize | generate ไฟล์ xlsx → flip Payroll `PENDING→CALCULATED` → **ปิดรอบ `OPEN→CLOSED` ทันที** ทั้งหมดใน transaction เดียว (generate พัง = ไม่แต่ nothing) |
| 2 | CLOSED = ล็อคเด็ดขาด | **ทุก action** ที่ mutate รอบ/ยอดจ่าย (สร้าง/คำนวณใหม่/แก้หัก/ยกเลิก) ห้ามทำ ไม่มี override — ต้อง `reopen` ก่อนเท่านั้น |
| 3 | CALCULATED = soft gate | แก้ไขได้แต่ต้องรู้ตัว: backend ตอบ **409** พร้อมรายการ payRef จนกว่าส่ง `allowExported: true` (pattern เดียวกับ `allowPendingSheets`) |
| 4 | Import เฉพาะ CLOSED | นำเข้าไฟล์ผลโอนธนาคาร (mark `CALCULATED→PAID`) ทำได้เฉพาะรอบ **CLOSED** — status อื่น 400 (phase นี้ยังเป็น TODO stub เปลี่ยนเฉพาะ guard) |
| 5 | Reopen ได้แม้มี PAID | ปลดล็อครอบเพื่อเพิ่มคน/ยอดที่ขาด — ตัว Payroll ที่ `PAID` แล้วห้ามแก้เหมือนเดิม (มี check อยู่แล้ว) |
| 6 | Badge ใหม่ | `CALCULATED` แสดงเป็น **"ส่งออกไฟล์แล้ว"** (เดิม "คำนวณแล้ว" กำกวม) |
| 7 | ชื่อ flag | `allowExported` — ตั้งตาม "เงื่อนไขที่ข้าม" ให้ขนานกับ `allowPendingSheets` (ใช้ร่วมทั้ง edit/recalc/cancel จึงไม่ผูกชื่อ action) |

### State machine ใหม่

```
Period:  OPEN ──export──► CLOSED ──import(CLOSED only)──► (Payroll → PAID)
           ▲                │
           └───── reopen ◄──┘

Payroll: PENDING ──export──► CALCULATED ──import──► PAID
         แก้ได้ปกติ           แก้ได้ต้อง 409→allowExported   ห้ามแก้ทั้งสิ้น
```

### เหตุผล (ช่องโหว่ปัจจุบัน — Measured จากโค้ด 4 พ.ย. 2026)

| Action | เช็ค payroll status | เช็ค period OPEN | ผล |
|---|---|---|---|
| `createPayrolls` / `cancelAllPayrolls` / `export` / `import` / `close` | — | ✅ | ปลอดภัย |
| `recalculatePayroll` (รายคน) | ✅ | ❌ | **ทะลุรอบปิด** |
| `recalculatePayPeriod` (ทั้งรอบ) | ✅ (ใน query) | ❌ ไม่เช็คเลย | **ทะลุรอบปิด** |
| `updatePayroll` (แก้ SSO/SLF/อื่นๆ) | ✅ | ❌ | **ทะลุรอบปิด** |
| `cancelPayroll` (รายคน) | ✅ | ❌ | **ทะลุรอบปิด** |

และ export เดิมปล่อยรอบค้าง OPEN → ทีมแก้ยอดหลัง export ได้โดยไม่รู้ว่าไฟล์ออกไปแล้ว

---

## 2. Matrix สิทธิ์หลังแก้ (backend บังคับทั้งหมด)

| Action | Payroll PENDING (รอบ OPEN) | Payroll CALCULATED (รอบ OPEN) | รอบ CLOSED |
|---|---|---|---|
| สร้างยอดจ่าย (`POST /:id/payrolls`) | ✅ | ✅ (คนใหม่/คนที่ยังไม่มี) | ❌ 400 (ของเดิม) |
| คำนวณใหม่รายคน (`PATCH /payrolls/:id/recalculate`) | ✅ | **409** → `allowExported` | ❌ 400 |
| คำนวณใหม่ทั้งรอบ (`PATCH /:id/recalculate`) | ✅ | **409** (มีแถว CALCULATED แถวใดแถวหนึ่ง) → `allowExported` | ❌ 400 |
| แก้การหัก (`PATCH /payrolls/:id`) | ✅ | **409** → `allowExported` | ❌ 400 |
| ยกเลิกรายคน (`DELETE /payrolls/:id`) | ✅ | **409** → `allowExported` | ❌ 400 |
| ยกเลิกทั้งรอบ (`DELETE /:id/payrolls`) | ✅ | **409** → `allowExported` | ❌ 400 (ของเดิม) |
| Export (`POST /:id/export`) | ✅ → รอบกลายเป็น CLOSED | ✅ (re-export หลัง reopen) → CLOSED | ❌ 400 (ของเดิม) |
| ปิดรอบมือ (`PATCH /:id/close`) | ✅ (มี `force`) | ✅ | ❌ 400 (ของเดิม) |
| เปิดรอบใหม่ (`PATCH /:id/reopen`) | — | — | ✅ (ของเดิม) |
| Import ไฟล์ธนาคาร (`POST /:id/import`) | ❌ 400 | ❌ 400 | TODO stub (กติกา #4) |

### รูปแบบ 409 (ใช้ `err.conflict` จาก utils/error.js)

- รายคน: `details: { payRef: "PAY-2026-11-001" }`
- ทั้งรอบ: `details: { exportedPayrolls: ["PAY-2026-11-001", ...] }`
- message: `'รายการนี้ส่งออกไฟล์แล้ว หากส่งไฟล์ให้ธนาคารไปแล้ว การแก้ไขจะทำให้ยอดไม่ตรงกัน (ส่ง allowExported เพื่อยืนยัน)'` (ปรับถ้อยคำตอน implement ได้ ความหมายต้องครบ: export แล้ว / อาจไม่ตรงไฟล์ / ต้องยืนยัน)
- รอบ CLOSED → `err.badRequest(null, 'รอบจ่ายปิดแล้ว ... ใช้เปิดรอบใหม่ก่อน')` (400)

---

## 3. Backend — ไฟล์ที่แก้

1. `src/services/pay-period.service.js`
   - `exportPayPeriod`: generate ก่อน (เหมือนเดิม) → `sequelize.transaction` { `Payroll.update PENDING→CALCULATED` + `payPeriod.update CLOSED` } → return `{ buffer, filename, updatedCount }`
   - `recalculatePayPeriod(id, { allowExported = false })`: เพิ่ม check CLOSED → 400; มี payroll CALCULATED ใน scope และไม่มี flag → 409 `exportedPayrolls`
   - `cancelAllPayrolls(id, { allowExported })`: เพิ่ม gate CALCULATED เหมือนกัน (รอบ CLOSED บล็อกอยู่แล้ว)
   - `importBankFile`: กลับ guard เป็น "ต้อง CLOSED" + ปรับ message
2. `src/services/payroll.service.js`
   - private `_assertMutable(payroll, { allowExported })`: รอบ CLOSED → 400 / payroll CALCULATED ไม่มี flag → 409 `{ payRef }`
   - `updatePayroll(id, data, { allowExported })`, `cancelPayroll(id, { allowExported })`, `recalculatePayroll(id, { allowExported })`: include `payPeriod` เอา `status` + เรียก helper (recalculatePayroll มี include อยู่แล้ว เพิ่ม attribute)
3. `src/controllers/payroll.controller.js` + `pay-period.controller.js`: เพิ่ม `allowExported: Joi.boolean().default(false)` ใน body ของ 5 action (recalc รายคน/ทั้งรอบ, แก้หัก, ยกเลิกรายคน/ทั้งรอบ)

## 4. Frontend — ไฟล์ที่แก้

1. `src/components/badge/payroll-status.vue` — `CALCULATED: "ส่งออกไฟล์แล้ว"` (กติกา #6)
2. `src/views/payroll/index.vue`
   - toast หลัง export: บอกทั้ง "สถานะเปลี่ยนเป็นส่งออกไฟล์แล้ว" + "ปิดรอบอัตโนมัติ"
   - `handleRecalculateAll` / `handleCancelAll`: จับ `response.error?.details.exportedPayrolls` → `openConfirmAction` เตือนความเสี่ยงไฟล์ไม่ตรง → retry พร้อม `allowExported: true` (มอดเดล `handleCreatePayrolls`)
   - menu "นำเข้าไฟล์ธนาคาร" ย้ายเข้ากลุ่ม CLOSED (ยัง disabled)
3. `src/components/view-payroll/payroll-detail-dialog.vue` — `canEdit` เพิ่ม `period.status !== 'CLOSED'` + `handleRecalculate`/`handleCancelPayroll` จับ 409 → confirm → retry
4. `src/components/view-payroll/deduction-edit-dialog.vue` — จับ 409 จากการบันทึก → confirm → retry ด้วย flag
5. `src/services/payroll-service.js` — ส่งต่อ `allowExported` ทั้ง 5 action

หมายเหตุ: 409 ยังโชว์ toast จาก interceptor เหมือน pattern pendingSheets ปัจจุบัน (เห็นทั้ง toast + dialog) — ไม่เปลี่ยนใน phase นี้

## 5. เอกสารที่ต้อง sync หลัง code เขียว

- `/business-rules` skill: `SKILL.md` (data flow ขั้น 6–7), `references/status-flow.md` (PayPeriod/Payroll กฎใหม่), `references/create-payroll-flow.md` (export/import/recalc/cancel)
- `docs/SSO-PLAN.md` กติกา #9: manual edit บน CALCULATED ต้องยืนยัน `allowExported` แล้ว (เพิ่มหมายเหตุ + บันทึกท้ายไฟล์)

---

## 6. ขั้นตอน (checklist)

### S1 — เขียน doc นี้
- [x] ใช้อ้างอิงระหว่าง implement (คุณ user สั่งเขียนก่อนเริ่มงาน)

### S2 — Backend gates + auto-close
- [x] exportPayPeriod ปิดรอบอัตโนมัติ (transaction)
- [x] 4 path ที่ทะลุ: เพิ่ม check CLOSED + gate CALCULATED (`_assertMutable`)
- [x] importBankFile กลับ guard
- [x] controllers รับ `allowExported`

### S3 — Backend tests
- [x] แก้ `test/flows/kbank-export.test.js` (หลัง export รอบ = CLOSED)
- [x] ไฟล์ใหม่ `test/flows/exported-gate.test.js`: export→CLOSED / CLOSED→mutate ได้ 400 / reopen→CALCULATED→409→flag ผ่านทุก action / PENDING แก้ได้ไม่ต้อง flag / import OPEN→400, CLOSED→stub
- [x] ตรวจ flow-4-export-reopen, flow-6-force-close, flow-8-reopen-closed ปรับตามพฤติกรรมใหม่ (+flow-1-happy-path)
- **Verify:** `npm test` เขียว 174/174 (169 เดิม + 5 ใหม่)

### S4 — Frontend
- [x] badge + toast export
- [x] 409 confirm dialog ครบ 5 จุด + service ส่ง flag
- [x] ซ่อนเมนูแถว payroll เมื่อรอบ CLOSED + ย้ายเมนู import
- **Verify:** `npm run build` ผ่าน / ยืนยันบน dev server จริง (export→CLOSED ผ่าน API) — **เหลือ: กดดู dialog ใน browser (ติด Chrome ของผู้ใช้ค้างกับ MCP profile)**

### S5 — Sync เอกสาร
- [x] /business-rules skill 3 ไฟล์ + SSO-PLAN.md #9 + บันทึกความคืบหน้า

### S6 — ปิดงาน
- [x] `npm test` เขียวทั้งหมด (174/174) / `graphify update .` / commit
  (backend `976bda7` + frontend `7b3bbc3` บน `feature/gate-edit-payroll`)

---

## บันทึกความคืบหน้า

- 4 พ.ย. 2026 — เขียนแผนจากการสำรวจโค้ด (ช่องโหว่ 4 path + พฤติกรรม export ซ้ำ) และตกลงกติกา 7 ข้อกับผู้ใช้ + เริ่ม execute
- 4 พ.ย. 2026 — execute ครบ S2–S5: export auto-close (transaction), gates CLOSED/CALCULATED
  (`_assertMutable` + 409 `allowExported`), import guard กลับเป็น CLOSED-only, frontend badge
  "ส่งออกไฟล์แล้ว" + confirm dialogs 5 จุด + ซ่อน action รอบปิด, sync skill 3 ไฟล์ + SSO-PLAN #9.
  Tests 174/174 (แก้ flow-1/4/6/8 + kbank-export ตามพฤติกรรมใหม่, ไฟล์ใหม่ exported-gate 5 เคส).
  ยืนยันบน dev server จริง (backend :9501): export → CLOSED+CALCULATED, reopen → 409 gate พร้อมทดสอบ
  — เหลือ verify dialog ใน browser (ติด Chrome เก่าค้างกับ MCP profile รอผู้ใช้ปิดให้)
- หมายเหตุ flake: มี run เดียวที่พัง 14 tests (1 ไฟล์) ระหว่างแก้ tests แล้วหายเอง —
  รันเต็มติดกัน 3 รอบหลังจากนั้นเขียว 174/174 ทั้งหมด (สงสัย state ค้างจากการรัน back-to-back, ไม่พบสาเหตุซ้ำ)
