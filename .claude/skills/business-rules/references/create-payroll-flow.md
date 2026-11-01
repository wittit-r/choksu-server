# การสร้าง Payroll — ขั้นตอนและ Transaction

## createPayrollsForPeriod()

ฟังก์ชัน: `createPayrollsForPeriod(payPeriodId, { employeeId? })` ใน `src/services/pay-period.service.js`

### เงื่อนไขเบื้องต้น

- PayPeriod ต้องมีสถานะ `OPEN`
- ถ้าระบุ `employeeId` → ตรวจสอบว่ายังไม่มี payroll ของคนนี้ใน period นี้

### เงื่อนไขที่ TimeEntry จะถูกรวม

เฉพาะ entry ที่ตรงเงื่อนไข **ทั้งหมด** นี้:

1. TimeSheet status = `FILLED`
2. TimeEntry status = `DRAFT`
3. `isNegative` = false
4. `isRetro` = false
5. `startTime` อยู่ในช่วง `startDate` - `endDate` ของ PayPeriod
6. พนักงานมี WageRate ที่ `position.employeeType` ตรงกับ PayPeriod
7. พนักงาน `isActive` = true
8. TimeEntry ยังไม่ถูก linked กับ Payroll อื่น (ผ่าน PayrollRelate)

### ขั้นตอนใน Transaction

```
1. วนลูปแต่ละ employee
2. ดึง TimeEntries ที่ยังไม่ linked (DRAFT + FILLED only)
3. ดึง WageRates สร้าง Map ตามวันที่ (_getWageRatesByDate)
4. คำนวณ paidValue สำหรับแต่ละ entry (_calculatePayrollAmounts)
5. Bulk update paidValue ลง time_entries (SQL raw $executeRaw)
6. อัปเดต TimeEntry status → LOCKED
7. สร้าง Payroll + PayrollRelate (createMany)
```

### payRef Format

```
PAY-{year}-{periodNo 2 หลัก}-{seq 3 หลัก}
```

ตัวอย่าง: `PAY-2026-01-001`, `PAY-2026-01-002`

---

## Recalculate — คำนวณใหม่

### recalculatePayroll(id)

- ดึง time entries ทั้งหมดของพนักงานในรอบ (**รวม negative และ retro**)
- เพิ่ม relate ใหม่สำหรับ entries ที่ยังไม่ linked
- คำนวณ paidValue ใหม่จาก **ทุก entry** (เก่า + ใหม่)
- ใช้ได้เฉพาะ PENDING หรือ CALCULATED

### recalculatePayPeriod(payPeriodId)

- ทำเช่นเดียวกับ recalculatePayroll แต่วนลูป **ทุก payroll** ในรอบ
- ใช้ได้เฉพาะ PENDING หรือ CALCULATED

---

## cancelPayroll(id) / cancelAllPayrolls(payPeriodId)

### cancelPayroll

- ใช้ได้เฉพาะ PENDING หรือ CALCULATED
- Transaction:
  1. ดึง timeEntryIds จาก PayrollRelate
  2. ลบ PayrollRelate ทั้งหมด
  3. คืน TimeEntry → status: DRAFT, paidValue: null
  4. อัปเดต Payroll status → CANCELLED

### cancelAllPayrolls

- ทำเช่นเดียวกันแต่วนลูปทุก payroll ที่ PENDING หรือ CALCULATED ใน payPeriod
- PayPeriod ต้องเป็น OPEN

---

## exportPayPeriod(payPeriodId)

- PayPeriod ต้องเป็น OPEN
- อัปเดต Payroll ทุกอันที่เป็น PENDING → CALCULATED
- (TODO: สร้าง Excel file)

## closePayPeriod(payPeriodId, { force })

- PayPeriod ต้องเป็น OPEN
- ถ้ามี PENDING อยู่และ force=false → error
- ถ้า force=true → ปิดรอบได้แต่ PENDING จะถูกข้าม

## reopenPayPeriod(payPeriodId)

- PayPeriod ต้องเป็น CLOSED
- อัปเดต status → OPEN
