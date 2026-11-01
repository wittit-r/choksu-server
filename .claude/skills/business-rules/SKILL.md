---
name: business-rules
description: >
  Business logic knowledge base ของระบบบริหารจัดการพนักงาน (Choksu)
  ครอบคลุม: ประเภทพนักงาน, การลงเวลา, สถานะ, สูตรคำนวณเงินเดือน, validation rules, retroactive, payroll flow

> ⚠️ **กติกาเวลา (สำคัญ):** ระบบใช้ MySQL + Sequelize — ทุกคอลัมน์เวลาเป็น **เวลาไทยตรงๆ** (DATETIME หลักวินาที) อ่านด้วย `getHours()` ปกติ / แก้ DB ตรงๆ ด้วยเวลาไทยได้ / ห้ามใช้ getUTC*
  ใช้เมื่อ: ทำงานเกี่ยวกับ timesheet, payroll, wage rate, คำนวณเงิน, หักเงิน, pay period, net pay,
  OT, overtime, accommodation, ค่าที่พัก, SSO, SLF, retroactive, correction, negative entry,
  หรือต้องการเข้าใจ flow การทำงานของระบบ
  Thai triggers: บิซิเนสรูล, business rule, สูตรคำนวณ, ลงเวลา, เงินเดือน, ค่าจ้าง, จ่ายเงิน,
  หักเงิน, ย้อนหลัง, ซ้อนทับ, แก้ไขย้อนหลัง, คนงาน, คนขับรถ, กะ, shift
argument-hint: "[topic: overview | employee | timesheet | calculation | validation | retroactive | payroll | status]"
---

# Business Rules — ระบบบริหารจัดการพนักงาน

## ภาพรวมระบบ

ระบบสำหรับจัดการพนักงานไปทำงานที่การไฟฟ้า ครอบคลุม: ลงเวลา, คำนวณเงินเดือน, เบิกจ่าย, วิเคราะห์กำไรขาดทุน

## สถาปัตยกรรม

```
Employee ──► WageRate ──► TimeSheet ──► TimeEntry ──► PayrollRelate ──► Payroll
                │                                          │                │
            อัตราค่าจ้าง                            จับคู่ entry↔payroll      PayPeriod
```

## การไหลของข้อมูล (Data Flow)

```
1. สร้าง PayPeriod (กำหนดรอบจ่าย)
2. ลงเวลาทำงาน → TimeSheet + TimeEntry (status: DRAFT)
3. ยืนยันใบลงเวลา → TimeSheet status: FILLED
4. สร้าง Payroll → คำนวณ paidValue → TimeEntry status: LOCKED
5. Export → Payroll status: CALCULATED
6. จ่ายเงิน → Payroll status: PAID, TimeEntry.paidDate
```

## ประเภทพนักงาน

| | WORKER (พนักงานรายวัน) | DRIVER (พนักงานขับรถ) |
|---|---|---|
| รอบจ่าย | 24 รอบ/ปี (ครึ่งเดือน) | 12 รอบ/ปี (รายเดือน) |
| TimeSheet | DAILY (ต่อ workLeader + workDate) | MONTHLY (ต่อ employee + monthPeriod) |
| ค่าจ้างหลัก | dailyRate | monthlyRate |
| Lunch break | มี (shiftType REGULAR → หัก 12:00-13:00) | ไม่มี |
| OT คำนวณ | dailyRate/hourlyRate/minuteRate | เหมือน WORKER |
| Pattern | Shared ร่วมทั้ง timesheet | ระบุ per-entry |
| Accommodation | ไม่รองรับโดยตรง | รองรับ |
| shiftType | REGULAR หรือ SHIFT | REGULAR เสมอ |

## สรุป netPay

```
netPay = (regularAmount + otAmount + accommodationAmount + retroAmount)
        - (deductionAmount + ssoAmount + slfAmount + otherDeduction)
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
| ถาม/เขียนสูตรคำนวณ REGULAR, OT, ACCOMMODATION, Negative | [references/calculation-formulas.md](references/calculation-formulas.md) |
| ถาม/เขียนเรื่อง retroactive, คำนวณย้อนหลัง | [references/retroactive.md](references/retroactive.md) |
| ถามเรื่องสรุปยอดจ่าย, netPay, workingDays, overtimeMinutes | [references/payroll-summary.md](references/payroll-summary.md) |
| ถามเรื่องขั้นตอนสร้าง payroll, recalculate, cancel, export | [references/create-payroll-flow.md](references/create-payroll-flow.md) |
| ถามเรื่อง validation: overlap, duplicate, workType, negative, correction | [references/validation-rules.md](references/validation-rules.md) |
| ถามเรื่อง TimeSheet/TimeEntry data model, use cases, Worker vs Driver flow | [references/timesheet.md](references/timesheet.md) |

## Source Code

| ไฟล์ | ส่วนที่สำคัญ |
|---|---|
| `src/services/pay-period.service.js` | คำนวณ payroll, wage rate lookup, summary |
| `src/services/payroll.service.js` | CRUD payroll, recalculate, cancel |
| `src/services/timesheet.service.js` | TimeEntry CRUD, validation, negative entry |
| `src/services/employee.service.js` | Retroactive calculation |
| `src/database/models.js` | Sequelize models ทั้งหมด (PayPeriod, Payroll, PayrollRelate, TimeSheet, TimeEntry ฯลฯ) — MySQL + timezone +07:00 |
