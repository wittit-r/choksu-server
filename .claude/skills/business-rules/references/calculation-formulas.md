# สูตรคำนวณเงิน — หัวใจของระบบ

ฟังก์ชันหลัก: `_calculateEntryAmount()` ใน `src/services/pay-period.service.js`

---

## REGULAR (เวลาปกติ)

```
1. คำนวณ effectiveMinutes:
   totalMinutes = (endTime - startTime) นาที

   ถ้า shiftType = REGULAR → หักเวลาพักกลางวัน:
   - overlapStart = max(startMin, 720)    // 12:00 = 720 นาที
   - overlapEnd   = min(endMin, 780)      // 13:00 = 780 นาที
   - ถ้า overlapStart < overlapEnd → effectiveMinutes -= (overlapEnd - overlapStart)

   ถ้า shiftType = SHIFT → ไม่หักเวลาพัก

2. คำนวณจำนวนเงิน:
   ถ้า effectiveMinutes >= 480 นาที (8 ชม.) → paidValue = dailyRate
   ถ้า effectiveMinutes < 480 นาที → paidValue = (ชม. × hourlyRate) + (นาทีเศษ × minuteRate)
```

**ตัวอย่าง**: ทำงาน 08:00 - 17:00 (shiftType REGULAR)
- totalMinutes = 540 นาที
- หักพัก 60 นาที → effectiveMinutes = 480 นาที
- 480 >= 480 → paidValue = dailyRate (เต็มวัน)

**ตัวอย่าง**: ทำงาน 08:00 - 15:00 (shiftType REGULAR)
- totalMinutes = 420 นาที
- หักพัก 60 นาที → effectiveMinutes = 360 นาที
- 360 < 480 → paidValue = (6 × hourlyRate) = 6 ชม. × อัตราชม.

**ตัวอย่าง**: ทำงาน 08:00 - 12:00 (shiftType REGULAR)
- totalMinutes = 240 นาที
- overlapStart = max(480, 720) = 720, overlapEnd = min(720, 780) = 720
- overlapStart ไม่น้อยกว่า overlapEnd → ไม่หักพัก
- effectiveMinutes = 240 นาที
- 240 < 480 → paidValue = (4 × hourlyRate) = 4 ชม. × อัตราชม.

---

## OVERTIME (ล่วงเวลา)

```
totalMinutes = (endTime - startTime) นาที
otMultiplier = otRate (ค่าเช่น 1, 1.5, 2, 3)

ถ้า totalMinutes >= 480 นาที → paidValue = dailyRate × otMultiplier
ถ้า totalMinutes < 480 นาที → paidValue = (ชม. × hourlyRate + นาทีเศษ × minuteRate) × otMultiplier
```

**หมายเหตุ**: OT **ไม่มี** การหักเวลาพักกลางวัน

**ตัวอย่าง**: OT 2 ชม. (otRate = 1.5)
- totalMinutes = 120
- paidValue = (2 × hourlyRate) × 1.5

**ตัวอย่าง**: OT นานมาก 10 ชม. (otRate = 2)
- totalMinutes = 600
- 600 >= 480 → paidValue = dailyRate × 2

---

## ACCOMMODATION (เบี้ยเลี้ยงที่พัก)

```
paidValue = accommodation (ค่าตรงๆ จากฟิลด์)
```

ไม่คำนวณจากเวลา ใช้จำนวนเงินที่ระบุตรงๆ

---

## Negative Entry (หักล้าง)

```
paidValue = -amount (ค่าลบจากสูตร REGULAR/OVERTIME ปกติ)
```

คำนวณเงินตามปกติ แล้ว **นำค่ามาติดลบ**
- ต้องอ้างอิง entry เดิมผ่าน `referenceEntryId`
- ช่วงเวลาต้องอยู่ **ภายใน** ช่วงของ entry เดิม
- ห้ามทับซ้อนกับ negative entry อื่นของ entry เดิมเดียวกัน
- ต้องจ่ายเงิน entry เดิมไปแล้ว (`paidDate` ไม่เป็น null) ถึงจะทำ negative ได้

---

## Retro Entry (ยอดจ่ายย้อนหลัง)

```
paidValue = ยอดส่วนต่างที่คำนวณได้แล้ว (มีอยู่แล้ว ไม่คำนวณซ้ำ)
```

Retro entry ถูกสร้างโดย `calculateRetroactive()` ใน EmployeeService
รายละเอียดดู [references/retroactive.md](retroactive.md)

---

## การจัดการทั้งกลุ่ม (_calculatePayrollAmounts)

ฟังก์ชัน `_calculatePayrollAmounts(timeEntries, wageRatesByDate)` วนลูปทุก entry:

```
for each entry:
  if isNegative → paidValue = -calculateEntryAmount(entry, wageRates)
  if isRetro    → skip (มี paidValue อยู่แล้ว)
  if ACCOMMODATION → paidValue = entry.accommodation
  else           → paidValue = calculateEntryAmount(entry, wageRates)
```

## ปัดเศษเงิน

- เงิน: `Math.round(value * 100) / 100` (ทศนิยม 2 ตำแหน่ง)
- workingDays: `Math.round(value * 1000) / 1000` (ทศนิยม 3 ตำแหน่ง)
