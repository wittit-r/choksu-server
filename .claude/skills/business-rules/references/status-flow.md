# Status Flow — สถานะของระบบ

## PayPeriod Status

```
OPEN ──────────────► CLOSED
  │                   ▲
  │                   │
  └── reopenPayPeriod ┘
```

- **OPEN**: รับข้อมูลได้, สามารถสร้าง/ยกเลิก payroll
- **CLOSED**: ล็อคแล้ว, ไม่สามารถสร้าง payroll ใหม่
- ปิดรอบด้วย `closePayPeriod()` — error ถ้ามี PENDING ที่ยังไม่ export (ใช้ `force=true` บังคับ)

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
- **CALCULATED**: export แล้ว พร้อมจ่าย
- **PAID**: จ่ายเงินแล้ว → **ห้ามแก้ไขอะไรทั้งสิ้น**
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

- PENDING หรือ CALCULATED → แก้ไข ssoAmount, slfAmount, otherDeduction ได้
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
