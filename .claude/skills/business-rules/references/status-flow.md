# Status Flow — สถานะของระบบ

## PayPeriod Status

```
OPEN ───export (auto-close)──► CLOSED ───import (CLOSED only)──► (Payroll → PAID)
  ▲                              │
  └───────── reopenPayPeriod ◄───┘
```

- **OPEN**: รับข้อมูลได้, สามารถสร้าง/ยกเลิก/คำนวณใหม่ (รายการ CALCULATED ต้องยืนยัน `allowExported`)
- **CLOSED**: ล็อคทุก action (สร้าง/แก้หัก/recalculate/cancel/export) **ไม่มี override** — ต้อง `reopenPayPeriod` ก่อนเท่านั้น (ยกเว้น import ไฟล์ธนาคารที่ทำได้เฉพาะรอบ CLOSED)
- **export = finalize**: ทุกครั้งที่ `exportPayPeriod()` สำเร็จ รอบปิดเป็น CLOSED อัตโนมัติ (flip PENDING→CALCULATED + ปิดรอบใน transaction เดียว)
- ปิดรอบด้วยมือ `closePayPeriod()` สำหรับรอบที่ไม่ export (รอบว่าง) — error ถ้ามี PENDING ที่ยังไม่ export (ใช้ `force=true` บังคับ)
- ดูรายละเอียด gates: [create-payroll-flow.md](create-payroll-flow.md) + docs/PAYROLL-EXPORT-LOCK-PLAN.md

### PayPeriod Fields

| Field | คำอธิบาย |
|---|---|
| `periodNo` | 1-24 (WORKER) หรือ 1-12 (DRIVER) |
| `year` | ปี |
| `employeeType` | WORKER หรือ DRIVER |
| `startDate` / `endDate` | ช่วงวันที่ของรอบ |
| `status` | OPEN หรือ CLOSED |

**Unique**: `year + periodNo + employeeType` = unique

---

## Payroll Status

```
PENDING ──► CALCULATED ──► PAID
   │                         ▲
   │                         │
   └── CANCELLED ────────────┘
```

- **PENDING**: สร้างใหม่แล้ว รอดำเนินการ
- **CALCULATED**: export แล้ว พร้อมจ่าย (UI แสดง badge "ส่งออกไฟล์แล้ว")
- **PAID**: จ่ายเงินแล้ว → **ห้ามแก้ไขอะไรทั้งสิ้น** (ตั้งสถานะผ่าน import ไฟล์ธนาคารของรอบ CLOSED)
- **CANCELLED**: ยกเลิก → คืน TimeEntry เป็น DRAFT, paidValue = null

### Payroll Fields

| Field | คำอธิบาย |
|---|---|
| `payRef` | `PAY-YYYY-PP-NNN` |
| `ssoAmount` | หักประกันสังคม |
| `slfAmount` | หักกองทุนสำรองเลี้ยงชีพ |
| `otherDeduction` | หักอื่นๆ |
| `paidDate` | วันที่จ่ายจริง |

### กฎ

- PENDING → แก้ไข ssoAmount, slfAmount, otherDeduction / recalculate / cancel ได้ปกติ
- CALCULATED (export ไปแล้ว) → ทำได้ทุกอย่างแต่ backend ตอบ **409** จนกว่าส่ง `allowExported: true`
  (รายคน: `details.payRef` / ทั้งรอบ: `details.exportedPayrolls[]` — pattern เดียวกับ allowPendingSheets)
- รอบ PayPeriod เป็น CLOSED → ห้าม mutate ทุก action (400) ไม่มี override ต้อง reopen ก่อน
- PAID หรือ CANCELLED → ห้ามแก้ไข
- ยกเลิกได้เฉพาะ PENDING หรือ CALCULATED
- ยกเลิกแล้วคืน TimeEntry ทั้งหมดเป็น DRAFT + paidValue = null

---

## TimeEntry Status

```
DRAFT ──► LOCKED
  ▲         │
  └─────────┘  (ยกเลิก Payroll)
```

- **DRAFT**: ยังไม่ได้คำนวณเงินเดือน
- **LOCKED**: ล็อคแล้ว ถูกจับคู่กับ Payroll

## TimeSheet Status

```
PENDING ──► FILLED
```

- **PENDING**: กำลังกรอกข้อมูล, สามารถเพิ่ม/แก้/ลบ TimeEntry ได้, ลบ TimeSheet ได้ (Cascade)
- **FILLED**: ยืนยันแล้ว, ห้ามเพิ่ม/แก้/ลบ TimeEntry ปกติ, แต่ยังสร้าง negative entry ได้

---

## TimeEntry ประเภท

| ประเภท | ฟิลด์ | คำอธิบาย |
|---|---|---|
| ปกติ | `isNegative=false`, `isRetro=false` | รายการเวลาทำงานปกติ |
| Negative | `isNegative=true` | หักล้างเวลาทำงาน (ต้องมี `referenceEntryId`) |
| Retro | `isRetro=true` | ยอดจ่ายเพิ่มจากการเปลี่ยน wage rate |

### WorkType

| WorkType | ต้องมีเวลา | otRate | accommodation |
|---|---|---|---|
| `REGULAR` | ใช่ | ต้องเป็น 0 | ต้องเป็น 0 |
| `OVERTIME` | ใช่ | ต้อง > 0 | ต้องเป็น 0 |
| `ACCOMMODATION` | ไม่ใช่ | ต้องเป็น 0 | ต้อง > 0 |

### ShiftType

| ShiftType | คำอธิบาย |
|---|---|
| `REGULAR` | กะปกติ → มีเวลาพักกลางวัน 12:00-13:00 |
| `SHIFT` | กะเวียน → ไม่มีเวลาพักกลางวัน |

### ฟิลด์สำคัญ

| Field | คำอธิบาย |
|---|---|
| `paidValue` | จำนวนเงินที่คำนวณได้ (บันทึกตอนสร้าง payroll) |
| `paidDate` | วันที่จ่ายจริง (null = ยังไม่จ่าย) |
| `referenceEntryId` | อ้างอิง entry เดิม (สำหรับ negative และ retro) |
