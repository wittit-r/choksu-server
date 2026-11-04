# แผนฟีเจอร์ประกันสังคม (SSO) — sso_config + หักอัตโนมัติใน payroll + รายงานนำส่ง

> **สถานะ: DONE — execute เสร็จ 4 พ.ย. 2026 (tests 169/169)** — เหลือ sync /business-rules skill รอผู้ใช้ยืนยัน
> **Branch:** `feature/sso`
> **วิธีใช้:** checklist ขั้นตอนด้านล่าง + จด log ใน "บันทึกความคืบหน้า" ท้ายไฟล์
> **หลักการ:** dev-only / tests ต้องเขียวทั้งชุดทุกขั้น / กติกาเวลาตาม PHASE-B-PLAN.md (เวลาไทยตรงๆ)

---

## 1. กติกาธุรกิจที่ตกลงแล้ว (ห้ามเปลี่ยนโดยไม่แจ้งผู้ใช้)

| # | เรื่อง | ข้อสรุป |
|---|---|---|
| 1 | ใครถูกหัก | WORKER + DRIVER **ทุกคน** ไม่มี flag ยกเว้นรายคน |
| 2 | ฐานคำนวณ | `regularAmount − correction(negative entries)` ของรอบ, clamp ที่ 0 — WORKER รวม holiday pay + ค่าจ้างวันลา / DRIVER ใช้ basePay หลังหักขาด (ก่อน clamp 0) / **ไม่รวม** OT, ค่าที่พัก, retro |
| 3 | อัตรา + เพดาน | จาก `sso_config` ณ **วันสิ้นสุดรอบ (endDate)** — cap = rate% × maxWage |
| 4 | WORKER (2 รอบ/เดือน) | `sso = min(ปัดสปส(rate × base), max(0, cap − Σ ssoAmount รอบก่อนในเดือน))` — "รอบก่อน" = payroll คนเดียวกัน status ≠ CANCELLED ใน period เดือนเดียวกัน (จับคู่ตามเดือนของ endDate) ที่ endDate น้อยกว่า — รองรับ >2 รอบ/เดือนอัตโนมัติ |
| 5 | DRIVER (12 รอบ/ปี) | รอบเดียวจบ `min(ปัดสปส(rate × base), cap)` |
| 6 | ปัดเศษ | ตามกฎสปส: เศษ ≥ 0.50 ปัดขึ้นเป็นบาท, < 0.50 ตัด (`Math.round` ตรงเงื่อนไข) |
| 7 | สร้างรอบสลับลำดับ | สูตรเดียวกันทุกกรณี — แก้ด้วยกด **recalculate** รอบหลัง (ไม่บล็อก ไม่เตือน 409) |
| 8 | ไม่มี config ครอบช่วง | SSO = 0 + **warning ใน response** (ไม่ error ไม่บล็อก) |
| 9 | Manual edit | แก้ `ssoAmount` มือได้เท่าเดิม (PENDING/CALCULATED), **recalculate ทับกลับตามสูตรเสมอ** |
| 10 | Config CRUD | **ห้ามช่วงเวลาทับกัน**, แก้/ลบแถวเก่าได้เสมอ (payroll เก็บ snapshot แล้ว ยอดเก่าไม่เพี้ยน — แต่ recalc รอบเก่าจะใช้ config ใหม่) |
| 11 | Validation PayPeriod ใหม่ | startDate/endDate ต้องอยู่ **เดือนปฏิทินเดียวกัน** ทั้ง WORKER และ DRIVER (บังคับตอน create) |
| 12 | AuditLog | **ข้าม**ในฟีเจอร์นี้ (ผู้ใช้จะไล่ทำทั้งระบบภายหลัง) |

### Test cases บังคับ (ตัวอย่างจริงจากผู้ใช้ — cap 875 = 5% × 17,500)

| คน | ครึ่งแรก | หักครั้ง 1 | ครึ่งหลัง | หักครั้ง 2 | รวม |
|---|---|---|---|---|---|
| A (500/วัน) | 14 วัน = 7,000 | 350 | 13 วัน = 6,500 | 325 | 675 |
| B (700/วัน) | 14 วัน = 9,800 | 490 | 13 วัน = 9,100 | 385 (= 875−490) | 875 |
| C (1,300/วัน) | 14 วัน = 18,200 | 875 (โดน cap) | 13 วัน = 16,900 | 0 | 875 |

---

## 2. Schema

### 2.1 ตารางใหม่ `sso_configs`

| Field | Type | หมายเหตุ |
|---|---|---|
| id | INT PK auto | |
| effectiveFrom | DATE NOT NULL | วันเริ่มใช้เงื่อนไข |
| effectiveTo | DATE NULL | null = ใช้ตลอดไป (pattern เดียวกับ WageRate) |
| ratePercent | DECIMAL(5,2) NOT NULL | อัตราเรียกเก็บ % (ปัจจุบัน 5.00) |
| maxWage | DECIMAL(12,2) NOT NULL | เพดานเงินเดือน (15,000 / 17,500 / 20,000 / 23,000) |
| createdAt/updatedAt | auto | |

- Index: `effective_from`
- Validation ใน service (ไม่ใช่ DB constraint): บันทึก/แก้ ต้องเช็คช่วงใหม่ **ไม่ทับ**กับแถวอื่น (ครอบคลุมกรณีแทรกแถวกลาง)
- Lookup config ของรอบ: `effectiveFrom <= periodEndDate AND (effectiveTo IS NULL OR periodEndDate <= effectiveTo)` — validation ห้ามทับรับประกันได้แถวเดียว

### 2.2 คอลัมน์ใหม่ใน `payrolls` (snapshot ตอน auto-calc)

| Field | Type | หมายเหตุ |
|---|---|---|
| ssoAmount | DECIMAL(12,2) | **มีอยู่แล้ว** — ยอดหักจริง (auto หรือ manual) |
| ssoBase | DECIMAL(12,2) NULL | ฐานค่าจ้างที่ใช้คิดตอน auto-calc (อ้างอิงเมื่อ amount ถูกแก้มือ) |
| ssoCap | DECIMAL(12,2) NULL | เพดานยอดหักที่ใช้ตอนคิด |

- Export/รายงาน **คำนวณฐานสดจาก entries ทุกครั้ง** ไม่อ่าน snapshot (สอดคล้อง "แก้ time_entry แล้ว recreate → ตัวเลขตามจริงเสมอ")
- Sync DB ด้วย `sequelize.sync({ alter: true })` (dev-only)

### 2.3 Seed (idempotent — เติมเฉพาะแถวที่ยังไม่มี effectiveFrom ตรงกัน)

| effectiveFrom | effectiveTo | ratePercent | maxWage |
|---|---|---|---|
| 2020-01-01 | 2025-12-31 | 5.00 | 15,000 |
| 2026-01-01 | 2028-12-31 | 5.00 | 17,500 |
| 2029-01-01 | 2031-12-31 | 5.00 | 20,000 |
| 2032-01-01 | NULL | 5.00 | 23,000 |

---

## 3. สูตร auto-calc (ใช้ร่วมทั้ง create + recalculate)

```
roundSso(x)        = Math.round(x)                       // ≥0.50 ขึ้น, <0.50 ตัด
config             = lookup ณ period.endDate             // ไม่พบ → sso = 0 + warning
base               = max(0, regularAmount − deductionAmount)   // ตามแถวที่ 2 ของตารางกติกา
raw                = roundSso(base × ratePercent / 100)
cap                = roundSso(maxWage × ratePercent / 100)

WORKER: prevPaid   = Σ payrolls.ssoAmount ของคนเดียวกัน ที่ status ≠ CANCELLED
                     ใน period เดือนเดียวกัน (เดือนของ endDate) ที่ endDate < รอบปัจจุบัน
         sso       = min(raw, max(0, cap − prevPaid))
DRIVER:  sso       = min(raw, cap)
```

- เขียน `ssoAmount + ssoBase + ssoCap` ลง Payroll ใน transaction เดียวกับการสร้าง/recalc
- รายการ warning (เช่นไม่มี config) ส่งกลับใน response: `warnings: ["SSO: ไม่พบเงื่อนไขช่วงวันที่ ..."]`
- Driver ที่ base = 0 (โดนหักขาดจน clamp) → sso = 0 อัตโนมัติ

---

## 4. Endpoints

| Method | Path | รายละเอียด |
|---|---|---|
| GET | `/api/sso-configs` | รายการทั้งหมด เรียงตาม effectiveFrom (ไม่ต้อง pagination — ไม่กี่แถว) |
| POST | `/api/sso-configs` | สร้าง (validate ห้ามทับช่วง) |
| PATCH | `/api/sso-configs/:id` | แก้ (validate ห้ามทับ ยกเว้นแถวตัวเอง) |
| DELETE | `/api/sso-configs/:id` | ลบได้เสมอ |
| GET | `/api/sso-configs/report?month=&year=` | **preview หน้าจอ** — JSON แถวเดียวกับที่ export (PAID only, จับกลุ่ม period ตามเดือนของ endDate, ฐานคำนวณสด) |
| GET | `/api/sso-configs/report/export?month=&year=` | ไฟล์ xlsx จาก aggregation เดียวกันกับ report บังคับ |

- Report/export ใช้ **service method เดียวกัน** เพื่อ screen กับไฟล์ตรงกันเสมอ
- Response report: `rows[] { employeeType, idCard, name, base, employeeAmount, employerAmount, total }` + `summary { base, employeeAmount, employerAmount, total }` + `warnings[]` (เช่น มีรอบในเดือนที่ไม่มี config)
- xlsx: sheet เดียว คอลัมน์ `ประเภท | เลขบัตร 13 หลัก (text กันหาย 0) | ชื่อ+นามสกุล | ฐานค่าจ้าง | ยอดเรียกเก็บลูกจ้าง | ยอดสมทบนายจ้าง | รวมส่ง` เรียงตามประเภทแล้วชื่อ + แถว SUM ท้ายตาราง (pattern `_generateExcelFile` เดิม)

---

## 5. Frontend

1. `views/settings/sso.vue` — CRUD sso_config (pattern `holidays.vue`) + เมนูใน settings
2. `views/reports/sso.vue` — เลือกเดือน/ปี → โหลดตาราง preview (PAID) + แถวรวม + ปุ่ม export xlsx
3. Toast warning ไม่มี config หลังสร้างยอดจ่าย (non-blocking)
4. หน้า payroll detail / deduction-edit-dialog — ใช้ของเดิม ค่า sso auto ลงมาเอง แก้มือได้ตามกติกา #9

---

## 6. ขั้นตอน (checklist)

### ☑ S1 — Schema + seed
- [x] models.js: `SsoConfig` + `Payroll.ssoBase/ssoCap` → sync alter → เช็ค DB
- [x] seed.js: เติม 4 แถว (idempotent) → รัน seed แล้ว SELECT ยืนยัน
- **Verify:** `npm test` ยังเขียว (136/136)

### ☑ S2 — CRUD sso-configs + tests
- [x] service/controller/routes + Joi (validate ห้ามช่วงทับ)
- [x] tests: CRUD + overlap (แทรกกลาง/ท้าย/ก่อนหน้า) + delete แถวที่ payroll ใช้แล้ว
- **Verify:** tests suite ใหม่เขียว

### ☑ S3 — Validation PayPeriod เดือนเดียวกัน + tests
- [x] `createPayPeriod` บังคับ start/end เดือนเดียวกัน (WORKER+DRIVER)
- **Verify:** test สร้างรอบ 26 ธ.ค.–25 ม.ค. → 400

### ☑ S4 — สูตร auto-calc + tests (หัวใจ)
- [x] helper lookup config + roundSso + cumulative
- [x] hook ใน `createPayrollsForPeriod` (ทั้ง path ทั้งรอบและทีละคน) + `recalculatePayroll`/`recalculatePayPeriod` + เขียน snapshot + warnings
- [x] tests: worker A/B/C (ตารางด้านบน) + ปัดเศษ 352.50→353, 352.49→352 + driver รายเดือน + base ติดลบ→clamp + ไม่มี config→0+warning + สร้างสลับลำดับแล้ว recalc แก้เอง + manual edit แล้ว recalc ทับ + cancel รอบแรก→recalc รอบสองได้ยอดเต็มใหม่
- **Verify:** tests เขียวทั้งชุด

### ☑ S5 — Report + Export + tests
- [x] service รวมยอดรายเดือน (PAID, ฐานสด) → endpoint report + export xlsx
- [x] tests: PAID-only, รวม WORKER 2 รอบ, เลขบัตรเป็น text, แถว SUM, เดือนที่ไม่มีข้อมูล
- **Verify:** ยิง endpoint เห็น JSON + ไฟล์ xlsx เปิดได้

### ☑ S6 — Frontend
- [x] settings/sso.vue + เมนู
- [x] reports/sso.vue (preview + export)
- [x] toast warning
- **Verify:** เปิดหน้าใน browser ครบทั้ง CRUD / preview / export

### ☑ S7 — ปิดงาน
- [x] `npm test` เขียวทั้งหมด
- [x] sync `/business-rules` skill (propose diff รอผู้ใช้ยืนยันก่อนแก้)
- [x] `graphify update .`
- [x] commit

---

## บันทึกความคืบหน้า

- 4 พ.ย. 2026 — เขียนแผน (draft) จากการ grill-me ครบทุก branch รออนุมัติ execute
- 4 พ.ย. 2026 — execute ครบ S1–S7: schema (sso_configs + payrolls.sso_base/sso_cap) + seed 4 แถว,
  CRUD /sso-configs (ห้ามช่วงทับ), validation รอบเดือนเดียวกัน, auto-calc ผ่าน _buildPayrollSummary
  (+tx) ที่ create/recalc 3 จุด, report+export xlsx, frontend settings/sso + reports/sso (MonthPicker)
  + toast warnings. Tests 169/169 (เพิ่ม 33: crud 15 + payroll 12 + report 6).
  UI ตรวจใน browser ครบ (ตาราง/409 toast/export binary ผ่าน network). ปรับเพิ่มจากแผนเดิม:
  สูตรสะสมใช้กับทุกประเภท (DRIVER 1 รอบ/เดือน prevPaid=0 ผลเท่าเดิม) เพื่อโค้ดเดียว
- เหลือ: sync /business-rules skill (ร่างแล้ว รอผู้ใช้ยืนยันตามกติกา)
