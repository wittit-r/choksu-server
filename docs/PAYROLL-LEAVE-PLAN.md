# แผน Implement — Payroll v2 + ระบบวันลา + ปฏิทินวันหยุด (v1)

> **สถานะ: อนุมัติแล้ว** (3 พ.ย. 2026) — **implement เสร็จครบ Phase 1-5 แล้ววันเดียวกัน**
> **Spec อ้างอิง:** [PAYROLL-LEAVE-SPEC-DRAFT.md](PAYROLL-LEAVE-SPEC-DRAFT.md) (ตัดสินครบ + ตัวอย่างแผ่นจ่ายจริง/golden cases อยู่ในนั้นแล้ว)
>
> 1. อ่าน spec ก่อนเริ่มทุก phase — โดยเฉพาะ section B (validation) C (worker) D (driver)
> 2. ห้ามข้าม phase ถ้า tests ไม่เขียว — commit ราย phase
> 3. แก้แผนต้องแจ้งผู้ใช้ก่อน

**Branch:** `feature/payroll-leave-v2` (แตกจาก `develop`)
**Scope v1 = ฝั่งจ่ายเงินให้พนักงานเท่านั้น** — ฝั่งเบิกจากไฟฟ้า (ตารางรายวัน + contract price) และ "ลาออกกลางเดือน" = อนาคต (Phase 2)
**ลำดับงาน:** backend ครบก่อน (verify ด้วย tests) → frontend ทีเดียวท้ายสุด
**กติกาที่ยกมาใช้:** dev-only reset ข้อมูลได้ · เวลาไทยตรงๆ (ห้าม getUTC*) · 4 spaces ·
controller→service→route · Express 5 ไม่ต้อง wrap · `/add-endpoint` skill สำหรับ endpoint ใหม่

**ข้อเท็จจริงที่ verify แล้ว (ไม่ต้องถามซ้ำ):** "ประเภทใบอนุญาติ" = Position เดิม (D01/D02/D02+) ·
"flag กะ" = `Employee.shiftType` · สูตรหักพัก 12:00–13:00 อยู่ที่ `_calculateEntryAmount()` (pay-period.service.js:717–740) ย้ายมาเป็น util กลาง ·
golden numbers ตรวจแล้วทั้งหมด (นายโอ 763.67 / นายเอ 9,218.08 / นายฉ 16,304 → 17,187.09 / worker holiday 1 แรง ฯลฯ) — ดู spec

---

## Step 0 — Sync เอกสาร ✅ (3 พ.ย. 2026)

- [x] ย้ายตารางแผ่นจ่ายจริงจาก PHASE-B-PLAN.md เข้า spec draft + แก้เลขนายฉ 16,034 → 16,304
- [x] Spec: worker payroll หน้าจ่าย = สรุปแบบ driver / scope ฝั่งเบิกออก / decision log อัปเดต
- [x] Sync แผนฉบับนี้

## Phase 1 — Schema + master data

**แตะ:** `src/database/models.js`, `scripts/seed.js`

1. เพิ่ม 4 models:

```
Holiday           id, holidayDate (DATE, unique), name
LeaveType         id, name (unique), defaultDaysPerYear INT, isActive (default true)
Leave             id, employeeId FK, leaveTypeId FK, startTime, endTime DATETIME, note, createBy
LeaveEntitlement  id, employeeId FK, year INT, leaveTypeId FK, entitledDays INT
                  unique(employeeId, year, leaveTypeId)
```

2. Sync schema (คำสั่ง alter ใน backend/CLAUDE.md) + seed: LeaveTypes **ลาป่วย 30 / พักร้อน 7 / ลากิจ 3**
   + Holidays ตัวอย่างปี 2026–2027

**Verify:** sync + seed รันผ่าน, `SELECT` เห็นข้อมูล, `npm test` ชุดเดิมยังเขียว

## Phase 2 — Leave / Holiday / Entitlement API + validation

**แตะ:** `src/utils/work-time.js` (ใหม่), `src/services/`, `src/controllers/`, `src/routes/`, `test/`

1. **Util กลาง** — `effectiveMinutes(start, end)` หักพัก 12:00–13:00 ถ้าคร่อม
   (ย้าย logic จาก `_calculateEntryAmount` มาใช้ร่วม: ชั่วโมงทำงาน / นาทีลา / ชั่วโมงทำจริง driver — สูตรเดียว)
2. **Endpoints** (แบ่งไฟล์ตาม module):
   - `holidays` — GET `?year`, POST, DELETE
   - `leave-types` — GET, POST, PATCH (DELETE = ปิด `isActive` ถ้าถูกอ้างอยู่, ห้ามลบจริง)
   - `leaves` — GET `?employeeId&year`, POST, DELETE
   - `leave-entitlements` — GET `?employeeId&year` (พร้อมยอดคงเหลือ **คำนวณสด** เป็นนาที),
     PATCH (รายคน — แก้ได้ตลอดปี, ต่ำกว่า used ได้), POST `/generate` (ปีเป้าหมายทั้งบริษัท)
3. **Validation ตอน POST /leaves** (spec section B ทั้ง 7 ข้อ):
   ช่วงเวลาถูกต้อง · กะ (Employee.shiftType=SHIFT) ลาได้ 24 ชม. / ปกติ → เฉพาะ 08:00–17:00 · ห้ามซ้อนทับทั้ง 2 ทาง
   (กับ TimeEntry และกับ Leave อื่น) · work+leave ≤ 480 นาที/วัน · ห้ามวันนักขัตฤกษ์ ·
   ห้ามคาบข้ามปี · **block เกินยอดคงเหลือ** (entitledMinutes − usedMinutes ต่อชนิด)

**Verify:** test file ใหม่ครอบ validation ทุกข้อ + happy path + block เกินสิทธิ์ — `npm test` เขียว

## Phase 3 — Worker payroll v2

**แตะ:** `src/services/pay-period.service.js`, `src/services/timesheet.service.js`, `test/`

1. ต่อ entry รายวัน —
   `paidMinutes = effectiveMinutes(entry) + leaveMinutes(วันนั้น)` → ≥480 = dailyRate / <480 = ย่อยหน่วย (= 0.5 แรงของแผ่นจริง)
2. Holiday pay: วันนักขัตฤกษ์ในรอบ (≥ employee.startDate) — ไม่มี entry → +dailyRate ณ วันนั้น (= "1 แรง" ในแผ่นจริง);
   มาทำงาน (entry holiday_2x/3x) → entry ตามสูตร OT **+ dailyRate holiday pay ซ้อนอีกชั้น**
3. `timesheet.service`: reject การสร้าง worker timesheet pattern ปกติในวันนักขัตฤกษ์
4. Summary worker: คง field เดิม + ตัวเลขรวมตามสูตรใหม่ (holiday pay + เวลาลารวมเข้า regularAmount — คือ "ค่าจ้างตามวัน")

**Verify:** tests ใหม่ (ลาเติมวัน / holiday pay ไม่มาทำ / มาทำซ้อน / ครึ่งวัน) + แก้ expected tests เดิม — ทั้งชุดเขียว

## Phase 4 — Driver payroll v2

**แตะ:** `src/services/pay-period.service.js`, `src/services/timesheet.service.js`, `test/`

1. เงินพื้นฐาน = `monthlyRate` (WageRate ณ รอบ) — REGULAR entry ไม่ผลต่อเงิน ใช้แค่นับ "มาทำงานกี่ชม."
2. `absentMinutes = Σ ทุกวัน จ–ส (ไม่ใช่ อาทิตย์/นักขัตฤกษ์): max(0, 480 − ชั่วโมงทำจริงหักพัก − นาทีลา)`
3. เงินหักย่อยหน่วยจาก absentMinutes (วัน×daily + ชม.×hourly + นาที×minute) · clamp ยอดสุดท้ายที่ 0
4. **เข้าใหม่กลางเดือน** (startDate อยู่ในรอบ): วันสุทธิ (entry + ลา + นักขัตฤกษ์ จ–ส นับแต่ startDate)
   × dailyRate + OT + ค่าที่พัก — เคสนายเอ (16×daily) เป็นเดิมพัน
5. Summary ใหม่ตามแผ่นจริง: `monthlyRate`, `absentMinutes`, เงินหักขาด, basePay,
   OT {1, 1.5, 3 × (rate, hours, amount)}, ค่าที่พัก {rate, count, amount}, รวมก่อน SSO/SLF
   (`deductionAmount` ยังเก็บเฉพาะ correction ตามเดิม)
6. `timesheet.service`: validate OT ของ driver ต้องอยู่นอก 08:00–17:00 (จ–ส)

**Verify:** tests — **golden cases จากแผ่นจริง** (นายเอ 11,394.21 / นายโอ 12,327.33 / นายฉ 17,187.09 /
นายทดสอบ 18,084.00) + เข้าใหม่กลางเดือน + clamp 0 — เขียว

## Phase 5 — Frontend (หลัง backend เขียวหมด)

**แตะ:** `frontend/src/views/timesheets/absence.vue` (แทน placeholder), views/components ใหม่, router/menu มีอยู่แล้ว

1. หน้าลงวันลา — เลือกคน+ชนิด+ช่วงเวลา (ปุ่ม "ทั้งวัน" ส่ง 08:00–17:00), โชว์ยอดสิทธิ์คงเหลือ,
   รับ error block จาก backend
2. หน้าจัดการวันหยุดนักขัตฤกษ์ (ต่อปี) + หน้า LeaveTypes/สิทธิ์ (generate ปีถัดไป, แก้รายคน,
   พนักงานใหม่ frontend คำนวณ prorata ปัดขึ้นให้ก่อนบันทึก)
3. หน้า payroll: **worker และ driver ใช้รูปแบบสรุปเหมือนกัน** (คล้ายแผ่น driver —
   worker: จำนวนวันทำงาน/แรง × ค่าจ้างวันละ + OT + รวม) — ไม่ทำตารางรายวัน (ของฝั่งเบิก อนาคต)

**Verify:** รัน browser จริง (dev server) ดูหน้าจอครบทุกหน้า + ลงลา/ทำจ่ายรอบจริง 1 รอบ

## Phase 6 — ปิดงาน

1. เสนอ diff อัปเดต `/business-rules` skill (สูตรใหม่ + validation ใหม่) — **รอ user ยืนยันก่อนแก้**
2. อัปเดตสถานะ spec doc + `graphify update .`
3. รายงานสรุป

---

## จุดที่ยังต้องถามระหว่างทำ (ไม่ block เริ่มงาน)

- Phase 3: ชื่อ field ใหม่ของ summary worker (holiday pay รวม/แยก)
- Phase 2 (ถ้าเจอ): พฤติกรรม "พนักงานปกติถูกดึงไปกะดึก" — ตรวจซ้อนทับกับกะอย่างไรเมื่อไม่มี flag กะ

## บันทึกความคืบหน้า

| วันที่ | ขั้น | ผล | หมายเหตุ |
|---|---|---|---|
| 2026-11-03 | Step 0 | ✅ ย้ายแผ่นจ่ายจริงเข้า spec + แก้ 16,034→16,304 + sync แผน | — |
| 2026-11-03 | Phase 1 | ✅ 4 models + seed (leave_types 3, holidays 25) — `npm test` 96/96 เขียว | เจอและแก้: string `T00:00:00` ถูก parse เป็น UTC เมื่อไม่มี TZ env → เก็บ 07:00 — เปลี่ยนเป็น numeric-local constructor แล้ว เก็บ `00:00:00` เป๊ะ |
| 2026-11-03 | Phase 2 | ✅ util `effectiveMinutes` + services/controllers/routes (holidays, leave-types, leaves, leave-entitlements) + validation 7 ข้อ — `npm test` 115/115 | สมมุติฐานที่ตัดสิน: 1 รายการลา = 1 วัน (ลาหลายวัน = หลายรายการ); พบว่ากติกา ≤480 มีผลจริงเฉพาะพนักงานกะ (พนักงานปกติ 08:00–17:00 รวมไม่พ้น 480 ทางโครงสร้าง) |
| 2026-11-03 | Phase 3 | ✅ worker คิดค่าจ้างต่อวัน + holiday pay + leave-only payroll + ห้าม pattern ปกติวันนักขัตฤกษ์ — `npm test` 124/124 | สถาปัตยกรรมที่ตัดสิน: holiday pay และค่าจ่ายวันลา (ไม่มี entry) คำนวณสดตอนอ่านสรุปยอด; นาทีลาวันที่มี entry top-up เข้า paidValue ตอนทำจ่าย; คนมีแต่วันลา (ไม่มี entry) ก็เกิด payroll |
| 2026-11-03 | Phase 4 | ✅ driver = monthlyRate − หักย่อยหน่วย + โหมดรายวันเข้าใหม่ + clamp 0 + OT นอก 08:00–17:00 จ–ส — **golden cases แผ่นจริง 4 รายผ่านครบ** `npm test` 131/131 | แก้ bug เก่า 2 ตัวระหว่างทาง: (1) PayPeriod endDate ถูก Joi parse เป็น UTC → เก็บ 07:00 และ `[lte endDate]` ทำ entry วันสุดท้ายของรอบหลุด — เปลี่ยนเป็น string+เที่ยงคืนไทย และ `[lt nextMidnight]` ทุกจุด (2) `_getWageRatesByDate` เทียบ timestamp ไม่ทน skew — เปลี่ยนเป็นเทียบระดับวันที่ |
| 2026-11-03 | Phase 5 | ✅ frontend ครบ: หน้าลงวันลา (บันทึก/ยอดสิทธิ์/ลบ) + วันหยุดนักขัตฤกษ์ + ชนิดวันลา/สิทธิ์ (generate/แก้รายคน) + payroll detail columns ใหม่ — build ผ่าน + browser ครบทุกหน้า | วงจรจริงบน browser: login → เลือกพนักงาน → บันทึกลาป่วยทั้งวัน → สิทธิ์ลด 30→29 (คำนวณสด) ✓ |
| 2026-11-03 | Phase 5 (E2E) | ✅ รอบจ่ายจริงบน dev DB: driver ต.ค. 2026 ลงเวลาครบ 27 วัน + ที่พัก 2 คืน → **netPay 18,084 = golden นายทดสอบเป๊ะ** | driver migrate จริง 2 คน (ไม่มีใบลงเวลา) ถูกนับขาด 26 วันและหักย่อยหน่วยถูกต้อง — dev DB ถูกแตะ: wage คนขับ01 + วันลา 1 รายการ + รอบจ่าย id 264 (dev-only ตามกติกา reset ได้) |
