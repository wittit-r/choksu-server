---
name: business-rules
description: >
  Business logic knowledge base ของระบบบริหารจัดการพนักงาน (Choksu)
  ครอบคลุม: ประเภทพนักงาน, การลงเวลา, วันลา/สิทธิ์/วันหยุดนักขัตฤกษ์, สถานะ,
  สูตรคำนวณเงินเดือน, validation rules, retroactive, payroll flow

  ⚠️ **กติกาเวลา (สำคัญ):** ระบบใช้ MySQL + Sequelize — ทุกคอลัมน์เวลาเป็น **เวลาไทยตรงๆ** (DATETIME หลักวินาที) อ่านด้วย `getHours()` ปกติ / แก้ DB ตรงๆ ด้วยเวลาไทยได้ / ห้ามใช้ getUTC*
  / สร้าง Date จาก string ให้ใช้ numeric constructor `new Date(y, m-1, d)` (string ISO จะถูก parse เป็น UTC → เก็บเพี้ยน 07:00)
  / เทียบ entry/leave กับปลายรอบต้องใช้ `[lt nextMidnight(endDate)]` ไม่ใช่ `[lte endDate]`
  ใช้เมื่อ: ทำงานเกี่ยวกับ timesheet, payroll, wage rate, คำนวณเงิน, หักเงิน, pay period, net pay,
  OT, overtime, accommodation, ค่าที่พัก, SSO, SLF, retroactive, correction, negative entry,
  วันลา, ลาป่วย, ลากิจ, พักร้อน, สิทธิ์วันลา, วันหยุดนักขัตฤกษ์, holiday,
  หรือต้องการเข้าใจ flow การทำงานของระบบ
  Thai triggers: บิซิเนสรูล, business rule, สูตรคำนวณ, ลงเวลา, เงินเดือน, ค่าจ้าง, จ่ายเงิน,
  หักเงิน, ย้อนหลัง, ซ้อนทับ, แก้ไขย้อนหลัง, คนงาน, คนขับรถ, กะ, shift,
  วันลา, ลาป่วย, ลากิจ, พักร้อน, สิทธิ์, ขาดงาน, วันหยุด, นักขัตฤกษ์
argument-hint: "[topic: overview | employee | timesheet | calculation | validation | leave | retroactive | payroll | status]"
---

# Business Rules — ระบบบริหารจัดการพนักงาน

## ภาพรวมระบบ

ระบบสำหรับจัดการพนักงานไปทำงานที่การไฟฟ้า ครอบคลุม: ลงเวลา, วันลา/วันหยุด, คำนวณเงินเดือน, เบิกจ่าย, วิเคราะห์กำไรขาดทุน

## สถาปัตยกรรม

```
Employee ──► WageRate ──► TimeSheet ──► TimeEntry ──► PayrollRelate ──► Payroll
    │           │                            ▲                            │
    │        อัตราค่าจ้าง                    │                         PayPeriod
    ├──► LeaveType ──► LeaveEntitlement      │
    │        (ชนิด+default)  (snapshot/ปี)   │
    ├──► Leave ◄─────────────────────────────┘ (validation ซ้อนทับกับ TimeEntry)
    └──► Holiday (ปฏิทินวันหยุดนักขัตฤกษ์ กรอกมือต่อปี)
```

## การไหลของข้อมูล (Data Flow)

```
0. (ต่อปี) กรอก Holidays ปีถัดไป + POST /leave-entitlements/generate (prorata ปัดขึ้นอัตโนมัติ)
1. สร้าง PayPeriod (กำหนดรอบจ่าย)
2. ลงเวลาทำงาน → TimeSheet + TimeEntry (status: DRAFT)
3. บันทึกวันลา (Leave) — ได้ทุกเมื่อ ผลเงินเข้าสูตรคำนวณโดยตรง
4. ยืนยันใบลงเวลา → TimeSheet status: FILLED
5. สร้าง Payroll → คำนวณ paidValue → TimeEntry status: LOCKED
   (holiday pay + ค่าจ้างวันลาไม่มี entry คำนวณสดตอนอ่านสรุปยอด ไม่ผูกกับ entry)
6. Export (finalize) → Payroll status: CALCULATED + PayPeriod status: CLOSED พร้อมกัน
   (generate ไฟล์ก่อน แล้ว flip ทั้งสองใน transaction เดียว — docs/PAYROLL-EXPORT-LOCK-PLAN.md)
7. Import ไฟล์ผลโอนธนาคาร (เฉพาะรอบ CLOSED) → Payroll status: PAID, TimeEntry.paidDate
```

## ประเภทพนักงาน

| | WORKER (พนักงานรายวัน) | DRIVER (พนักงานขับรถ) |
|---|---|---|
| รอบจ่าย | 24 รอบ/ปี (ครึ่งเดือน) | 12 รอบ/ปี (รายเดือน) |
| TimeSheet | DAILY (ต่อ workLeader + workDate) | MONTHLY (ต่อ employee + monthPeriod) |
| ค่าจ้างหลัก | จำนวนวัน × dailyRate (วันลา/วันหยุดนับเป็นวันทำงาน) | monthlyRate − หักขาดงานรายชั่วโมง |
| Lunch break | มี (shiftType REGULAR → หัก 12:00-13:00) | มี (หัก 12:00-13:00 เหมือนกัน — ใช้ `effectiveMinutes` ร่วมกัน) |
| OT | สูตรเดิม (pattern holiday_2x/3x สำหรับทำงานวันหยุด) | ได้เฉพาะ **นอก 08:00–17:00 จันทร์–เสาร์** (อาทิตย์/นักขัตฤกษ์ OT ได้ทุกช่วง) |
| วันหยุดนักขัตฤกษ์ | ได้ dailyRate อัตโนมัติ (มาทำซ้อนกับ holiday_2x/3x ได้อีกชั้น) | ไม่มีชั่วโมงคาดหวัง = ไม่นับขาด (เงินพื้นฐานครอบอยู่แล้ว) |
| วันลา | นาทีลา "เติม" วันทำงานให้ครบ 480 (ลาไม่มา = จ่ายที่สรุปยอด) | ไม่นับขาด (ทั้งวัน/รายชั่วโมง) |
| Pattern | Shared ร่วมทั้ง timesheet | ระบุ per-entry |
| Accommodation | ไม่รองรับโดยตรง | รองรับ |
| shiftType | REGULAR หรือ SHIFT | REGULAR เสมอ |
| เข้าใหม่กลางรอบ | คิดตามวันอยู่แล้ว | สลับเป็นจ่ายรายวัน: วันสุทธิ × dailyRate |

## สรุป netPay

```
WORKER: netPay = (regularAmount + otAmount + accommodationAmount + retroAmount)
                 - (deductionAmount + ssoAmount + slfAmount + otherDeduction)
        regularAmount รวม holiday pay และค่าจ้างวันลาที่ไม่มี entry แล้ว

DRIVER: basePay = monthlyRate - absenceDeduction   (clamp ยอดจ่ายสุดท้ายที่ 0)
        หรือ (เข้าใหม่กลางเดือน) basePay = วันสุทธิ × dailyRate
        netPay = basePay + otAmount + accommodationAmount + retroAmount - (deduction ต่างๆ)
        deductionAmount เก็บเฉพาะ correction/เรียกคืน — การหักขาดอยู่ใน absenceDeduction แยก
```

## Enum สำคัญ

```
TimeSheetType:  DAILY | MONTHLY
TimeSheetStatus: PENDING | FILLED
WorkType:       REGULAR | OVERTIME | ACCOMMODATION
ShiftType:      REGULAR (หักพักกลางวัน) | SHIFT (ไม่หัก)
TimeEntryStatus: DRAFT | LOCKED
PayPeriodStatus: OPEN | CLOSED
PayrollStatus:   PENDING → CALCULATED → PAID | CANCELLED
```

## References

อ่านเฉพาะไฟล์ที่เกี่ยวข้องกับงานปัจจุบัน:

| อ่านเมื่อ | ไฟล์ |
|---|---|
| ถามเรื่อง WORKER vs DRIVER, รอบจ่าย, lunch break | [references/employee-types.md](references/employee-types.md) |
| ถามเรื่องสถานะ PayPeriod/Payroll/TimeSheet/TimeEntry, กฎการยกเลิก | [references/status-flow.md](references/status-flow.md) |
| ถามเรื่อง WageRate, effectiveFrom/To, การหา rate ตามวัน | [references/wage-rate.md](references/wage-rate.md) |
| ถาม/เขียนสูตรคำนวณ REGULAR, OT, ACCOMMODATION, Negative, **สูตร driver รายเดือน/หักขาด, holiday pay** | [references/calculation-formulas.md](references/calculation-formulas.md) |
| ถาม/เขียนเรื่อง retroactive, คำนวณย้อนหลัง | [references/retroactive.md](references/retroactive.md) |
| ถามเรื่องสรุปยอดจ่าย, netPay, workingDays, overtimeMinutes, **field ใหม่ driver/worker** | [references/payroll-summary.md](references/payroll-summary.md) |
| ถามเรื่องขั้นตอนสร้าง payroll, recalculate, cancel, export | [references/create-payroll-flow.md](references/create-payroll-flow.md) |
| ถามเรื่อง validation: overlap, duplicate, workType, negative, correction, **วันลา, OT window, นักขัตฤกษ์** | [references/validation-rules.md](references/validation-rules.md) |
| ถามเรื่อง **วันลา, สิทธิ์, LeaveType/LeaveEntitlement, Holiday, prorata, ยอดคงเหลือ** | [references/leave.md](references/leave.md) |
| ถามเรื่อง TimeSheet/TimeEntry data model, use cases, Worker vs Driver flow | [references/timesheet.md](references/timesheet.md) |

## Source Code

| ไฟล์ | ส่วนที่สำคัญ |
|---|---|
| `src/services/pay-period.service.js` | คำนวณ payroll, wage rate lookup, summary (worker ต่อวัน / driver รายเดือน) |
| `src/services/payroll.service.js` | CRUD payroll, recalculate, cancel |
| `src/services/timesheet.service.js` | TimeEntry CRUD, validation, negative entry, OT window, holiday pattern |
| `src/services/leave.service.js` | บันทึกวันลา + validation 7 ข้อ |
| `src/services/leave-entitlement.service.js` | สิทธิ์ + ยอดคงเหลือคำนวณสด + generate/prorata |
| `src/services/leave-type.service.js` + `holiday.service.js` | master data วันลา/วันหยุด |
| `src/utils/work-time.js` | `effectiveMinutes(start, end, {lunch})` — สูตรนาทีกลาง (work/ลา/ชั่วโมงทำจริง driver) |
| `src/services/employee.service.js` | Retroactive calculation (driver ยังเป็น TODO) |
| `src/database/models.js` | Sequelize models ทั้งหมด (PayPeriod, Payroll, PayrollRelate, TimeSheet, TimeEntry, Holiday, LeaveType, Leave, LeaveEntitlement ฯลฯ) — MySQL + timezone +07:00 |
