# Flows

## Status Flow

```
PayPeriod:
  OPEN ──close──▶ CLOSED ──reopen──▶ OPEN
  OPEN ──close(force)──▶ CLOSED
  (export เปลี่ยนเฉพาะ Payroll PENDING → CALCULATED — ไม่กระทบสถานะรอบ)

Payroll:
  PENDING ──export──▶ CALCULATED
  CALCULATED ──reopen period──▶ (ยังคง CALCULATED ต้อง recalculate เอง)
  PENDING/CALCULATED ──cancel──▶ CANCELLED
  CALCULATED ──import bank──▶ PAID

TimeEntry:
  DRAFT ──สร้าง payroll──▶ LOCKED (พร้อม paidValue)
  LOCKED ──ยกเลิก payroll──▶ DRAFT (paidValue = null)

PATCH /payrolls/:id แก้ได้เมื่อ: PENDING, CALCULATED
PATCH /payrolls/:id แก้ไม่ได้เมื่อ: PAID, CANCELLED
```

## Business Flows

### Flow 1: Happy Path — จ่ายเงินปกติทุกคน

ข้อมูลครบ ทุกคนพร้อมจ่าย

```
สร้างรอบ (OPEN)
  → ลงเวลาครบ → TimeSheet: FILLED, TimeEntry: DRAFT
  → POST /pay-periods/:id/payrolls
      สร้าง payroll ทุกคน → PENDING
      time entry → LOCKED + paidValue
  → POST /pay-periods/:id/export
      payroll ทั้งหมด PENDING → CALCULATED
  → PATCH /pay-periods/:id/close
      period: OPEN → CLOSED
  → POST /pay-periods/:id/import
      นำเข้าไฟล์ธนาคาร → payroll เป็น PAID ตามไฟล์
```

### Flow 2: ข้อมูลยังไม่ครบ — สร้าง payroll ทีละส่วน

บางใบเซ็นชื่อยังไม่กรอก แต่อยากเริ่มสร้าง payroll ไปก่อน

```
สร้างรอบ (OPEN)
  → ลงเวลาครบเฉพาะ 10 คน → TimeSheet: FILLED
  → POST /pay-periods/:id/payrolls
      สร้าง payroll 10 คน → PENDING
      (5 คนที่เหลือไม่ถูกสร้าง เพราะ time entry ยัง DRAFT ไม่ผ่าน filter)

  ... 2 วันผ่านไป กรอกเพิ่มอีก 3 คน ...

  → POST /pay-periods/:id/payrolls { employeeId: 15 }
      สร้าง payroll เฉพาะคนที่ 15 → PENDING
  → POST /pay-periods/:id/payrolls
      สร้าง payroll อีก 2 คนที่เหลือ
      (ระบบข้ามคนที่มี payroll อยู่แล้วอัตโนมัติ)

  → export → close → import (เหมือน Flow 1)
```

### Flow 3: สร้าง payroll แล้ว เจอข้อมูลพนักงานผิด

สร้าง payroll ทุกคนแล้ว แต่เจอว่าเวลาผิดพลาด (ก่อนโอนเงิน)

```
สร้าง payroll ทุกคน → PENDING
  → DELETE /payrolls/:id (ของคนที่มีปัญหา)
      payroll → CANCELLED
      time entry → DRAFT, paidValue = null
  → แก้ไข time entry
  → POST /pay-periods/:id/payrolls { employeeId: คนที่มีปัญหา }
      สร้าง payroll ใหม่ → PENDING
  → export → close → import
```

หมายเหตุ: negative/retro entry ใช้สำหรับจ่ายในรอบ **ถัดไป** ไม่ใช่รอบปัจจุบัน
ดังนั้นแก้ข้อมูลผิดในรอบปัจจุบันต้องใช้วิธียกเลิก → แก้ → สร้างใหม่เท่านั้น

กลไก: ตอนสร้าง/คำนวณยอดจ่าย ระบบดึง correction (isNegative) และ retro (isRetro)
ที่ยังไม่ถูกจ่าย ย้อนหลังจาก startDate ของรอบตาม `PAYROLL_LOOKBACK_DAYS`
(default 90 วัน — เปลี่ยนได้ผ่าน ENV) — กันซ้ำข้ามรอบด้วย PayrollRelate (global)

### Flow 4: Export แล้ว ต้องเพิ่มพนักงานใหม่

export แล้ว แต่มีพนักงานคนใหม่เข้ามา / กรอกเวลาเพิ่ม

```
export แล้ว → payroll ทั้งหมด CALCULATED (รอบยัง OPEN)
  → กรอกเวลาเพิ่มให้พนักงานใหม่ → TimeSheet: FILLED, TimeEntry: DRAFT
  → PATCH /pay-periods/:id/close → CLOSED
  → PATCH /pay-periods/:id/reopen
      period: CLOSED → OPEN
      (payroll เดิมยังคง CALCULATED ไม่เปลี่ยน)
  → POST /pay-periods/:id/payrolls { employeeId: 30 }
      สร้าง payroll ให้คนใหม่ → PENDING
  → POST /pay-periods/:id/export
      เฉพาะ payroll PENDING ที่เพิ่มมาใหม่ → CALCULATED
      (payroll เดิมที่ CALCULATED อยู่แล้ว ไม่ถูกเปลี่ยน)
  → PATCH /pay-periods/:id/close
      period: OPEN → CLOSED
  → POST /pay-periods/:id/import
      import ไฟล์ธนาคารที่มีรายการใหม่ด้วย → PAID
```

### Flow 5: โอนเงินไม่ครบ — บางรายการมีปัญหา

โอนเงินแล้ว แต่ธนาคารบอกว่าบางรายการโอนไม่สำเร็จ

```
export → close → import ไฟล์ธนาคาร
  → payroll ส่วนใหญ่ → PAID
  → payroll บางรายการ → ยัง CALCULATED (ไม่อยู่ในไฟล์ธนาคาร)

  → แก้ไขข้อมูลที่ผิด (เช่น แก้เลขบัญชี)
  → POST /pay-periods/:id/export
      สร้างไฟล์ Excel ใหม่จาก payroll ที่ยังไม่ PAID (CALCULATED)
  → POST /pay-periods/:id/import
      import ไฟล์ธนาคารรอบใหม่ → payroll ที่เหลือ → PAID
```

### Flow 6: Force close — ต้องปิดรอบทันทีแม้ข้อมูลยังไม่ครบ

deadline ปิดรอบ แต่ยังมีพนักงานที่ไม่ได้ลงเวลา

```
สร้าง payroll ครึ่งหนึ่ง → PENDING
  → พนักงานอีกครึ่งยังไม่ลงเวลา

  → PATCH /pay-periods/:id/close (ไม่มี force)
      ❌ ERROR: "มีรายการจ่าย N รายการที่ยังไม่ได้ export"

  → POST /pay-periods/:id/export
      payroll ที่มี → CALCULATED

  → PATCH /pay-periods/:id/close
      ยังมีพนักงานที่ไม่มี payroll แต่ไม่มี PENDING payroll แล้ว
      → period: CLOSED ✅

  หรือ:

  → PATCH /pay-periods/:id/close?force=true
      บังคับปิดทันที แม้มี payroll PENDING อยู่
      payroll PENDING จะถูกข้าม (ยังคง PENDING)
      → period: CLOSED ✅
```

### Flow 7: Recalculate — มี time entry เพิ่มเข้ามาหลังสร้าง payroll

สร้าง payroll แล้ว (PENDING) แต่มี negative/retro entry เพิ่มเข้ามาทีหลัง

```
สร้าง payroll → PENDING
  → มี time entry ใหม่เข้ามา (เช่น negative entry จากรอบก่อนหน้า)
  → PATCH /pay-periods/:id/recalculate หรือ PATCH /payrolls/:id/recalculate
      ระบบตรวจสอบ time entry ทั้งหมดในช่วงเวลา
      → เจอ entry ใหม่ที่ยังไม่ linked → สร้าง PayrollRelate ใหม่
      → คำนวณ summary + paidValue ใหม่
      → อัปเดต payroll
```

### Flow 8: ปิดรอบไปแล้ว ต้องเพิ่มคนเพิ่ม

เหมือน Flow 4 แต่รอบปิดไปแล้ว

```
รอบจ่าย CLOSED แล้ว
  → PATCH /pay-periods/:id/reopen
      period: CLOSED → OPEN
  → POST /pay-periods/:id/payrolls { employeeId: คนใหม่ }
      สร้าง payroll → PENDING
  → POST /pay-periods/:id/export
      payroll ใหม่ → CALCULATED
  → PATCH /pay-periods/:id/close
      period: CLOSED
  → POST /pay-periods/:id/import
      import ไฟล์ธนาคาร → PAID
```

### Flow 9: Retro — อัตราค่าจ้างเปลี่ยนกลางสัญญา

อัตราค่าจ้างเปลี่ยน ต้องจ่ายเพิ่มย้อนหลังให้พนักงานที่ได้รับผลกระทบ

```
รอบปัจจุบัน: สร้าง payroll และจ่ายเงินเรียบร้อย (PAID)
  → อัตราค่าจ้างเปลี่ยน
  → POST /payrolls/retro-calculate { startDate, endDate }
      สร้าง retro time entry (isRetro=true) สำหรับช่วงที่ค่าจ้างต่าง
  → รอบถัดไป: สร้าง payroll ปกติ
      retro entry จะถูกรวมเข้ามาในรอบนี้โดยอัตโนมัติ
      (เพราะ recalculate ดึง time entry ทั้งหมดในช่วงเวลา)
```

หมายเหตุ: retro entry จะถูกรวมไปจ่ายในรอบถัดไปเท่านั้น ไม่ใช่รอบที่ผ่านมาแล้ว

## ข้อจำกัดสำคัญ

| Action | PayPeriod ต้องเป็น | Payroll ต้องเป็น | ผลกระทบต่อ TimeEntry |
|--------|-------------------|-------------------|---------------------|
| สร้าง payroll | OPEN | — | DRAFT → LOCKED, ตั้ง paidValue |
| ยกเลิก payroll (เดี่ยว) | ไม่สน | PENDING, CALCULATED | LOCKED → DRAFT, paidValue=null |
| ยกเลิก payroll (ทั้งรอบ) | OPEN | PENDING, CALCULATED | เดียวกับข้างบน |
| recalculate (รอบ) | ไม่สน | PENDING, CALCULATED | อัปเดต paidValue ทั้งหมด |
| recalculate (เดี่ยว) | ไม่สน | PENDING, CALCULATED | อัปเดต paidValue + เพิ่ม relate |
| export | OPEN | PENDING → CALCULATED | — |
| close | OPEN | — | — |
| reopen | CLOSED | — | — (payroll ไม่เปลี่ยน) |
| import | — | CALCULATED → PAID | — |
| แก้ไข payroll (ยอดหัก) | — | PENDING, CALCULATED | — |

## Calculation Formulas

```
REGULAR (shiftType = REGULAR):
  หักพัก 12:00-13:00 ถ้า work time ทับช่วงพัก
  ≥ 480 นาที → dailyRate
  < 480 นาที → fullHours × hourlyRate + remainMinutes × minuteRate

REGULAR (shiftType = SHIFT):
  ไม่หักพัก
  ≥ 480 นาที → dailyRate
  < 480 นาที → fullHours × hourlyRate + remainMinutes × minuteRate

OVERTIME:
  ≥ 480 นาที → dailyRate × otRate
  < 480 นาที → (fullHours × hourlyRate + remainMinutes × minuteRate) × otRate

ACCOMMODATION:
  ใช้ค่า entry.accommodation โดยตรง

Wage Rate Lookup:
  ดึง rate ณ วันที่ของแต่ละ time entry (รองรับการเปลี่ยน rate กลางรอบ)
```
