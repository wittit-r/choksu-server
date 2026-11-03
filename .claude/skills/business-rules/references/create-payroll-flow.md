# การสร้าง Payroll — ขั้นตอนและ Transaction

## createPayrollsForPeriod()

ฟังก์ชัน: `createPayrollsForPeriod(payPeriodId, { employeeId? })` ใน `src/services/pay-period.service.js`

### เงื่อนไขเบื้องต้น

- PayPeriod ต้องมีสถานะ `OPEN`
- ถ้าระบุ `employeeId` → ตรวจสอบว่ายังไม่มี payroll ของคนนี้ใน period นี้

### เงื่อนไขที่ TimeEntry จะถูกรวม

เฉพาะ entry ที่ตรงเงื่อนไข **ทั้งหมด** นี้ (entry ปกติ):

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
5. Bulk update paidValue ลง time_entries (helper `_bulkUpdatePaidValue` — sequelize.query CASE WHEN)
6. อัปเดต TimeEntry status → LOCKED
7. สร้าง Payroll + PayrollRelate (createMany)
```

### Carryover (correction/retro เข้ารอบถัดไป)

นอกเหนือจาก entry ปกติในช่วงรอบ ระบบดึง **correction (isNegative) และ
retro (isRetro) ที่ยังไม่ถูกจ่าย (status DRAFT)** ย้อนหลังจาก startDate
ของรอบตาม `PAYROLL_LOOKBACK_DAYS` (default 90 วัน) — correction/retro จึง
ถูกหัก/จ่ายใน **รอบถัดไป** หลังถูกสร้าง กันซ้ำข้ามรอบด้วย PayrollRelate (global)

### payRef Format

```
PAY-{year}-{periodNo 2 หลัก}-{seq 3 หลัก}
```

ตัวอย่าง: `PAY-2026-01-001`, `PAY-2026-01-002`

---

## Recalculate — คำนวณใหม่

### recalculatePayroll(id)

- ดึง time entries ทั้งหมดของพนักงานในรอบ (**รวม negative และ retro**)
  บวก carryover ย้อนหลัง (PAYROLL_LOOKBACK_DAYS) ที่ยังไม่ถูกจ่าย
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

---

## การคัดคนเข้า payroll (Payroll leave v2 — พ.ย. 2026)

- **WORKER**: candidates = คนที่มี TimeEntry ในรอบ **∪ คนที่มีวันลาในรอบ**
  (ลาเต็มรอบไม่มาทำงานก็ต้องได้ payroll — จ่ายผ่าน leaveOnlyAmount)
- **DRIVER**: candidates = พนักงาน active ที่มี WageRate ตรงประเภท + startDate ≤ endDate ของรอบ
  **ทุกคน** (เงินเดือนรายเดือน — ไม่มี entry = ขาดทั้งรอบ โดนหักจน clamp 0)
- Worker ที่ allEntries ว่างแต่มีวันลา → สร้าง payroll ด้วย relates ว่างได้

## ใบค้าง PENDING gate (เพิ่ม 3 พ.ย. 2026)

- ก่อนสร้างยอดจ่าย: ถ้ามี TimeSheet **PENDING** ที่มี entry ในช่วงรอบ และเจ้าของมี wageRate
  ตรงประเภทของรอบ → **409 CONFLICT** พร้อม `details.pendingSheets` (ชื่อคน + อ้างอิงใบ)
- ยืนยันข้ามด้วย `allowPendingSheets: true` ได้ (pattern เดียวกับ allowDuplicate) —
  frontend แสดง confirm dialog พร้อมรายชื่อใบก่อนส่ง flag
- เหตุผล: entry ของใบ PENDING ไม่ถูกนับ (driver = ขาดทั้งรอบ / worker = วันนั้นหายเงียบๆ)
  — เคยทำให้ user งงว่า "ทำไมขาดงานหมด" เพราะลืมปรับ FILLED
- ลำดับสำคัญ: check ต้องอยู่ "ก่อน" early-return ของ candidate ว่าง
  (เจ้าของใบ PENDING ไม่อยู่ใน candidate pool ซึ่งกรองจากใบ FILLED)
- Sequelize trap: include ระดับกลาง (nested wageRates) ห้าม `attributes: []` — ใช้ `['id']`
- กู้ข้อมูลที่จ่ายไปแล้วโดยลืม FILLED: ปรับใบเป็น FILLED แล้วสร้างยอดจ่ายอีกครั้ง
  (entry ที่ยัง DRAFT จะถูกดึงเข้ารอบเดิม)
