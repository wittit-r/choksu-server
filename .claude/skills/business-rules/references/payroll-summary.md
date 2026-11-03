# Payroll Summary — สรุปยอดจ่าย

ฟังก์ชันหลัก: `_buildPayrollSummary(payroll, wageRate, ctx)` ใน `src/services/pay-period.service.js`
(ctx = { employeeType, periodStartDate, periodEndDate } — คำนวณสดตอนอ่าน)

## สูตร netPay

```
WORKER:
regularAmount       = Σ paidValue REGULAR + holidayAmount + leaveOnlyAmount
otAmount            = Σ paidValue OVERTIME
accommodationAmount = Σ paidValue ACCOMMODATION
deductionAmount     = Σ |paidValue| ของ Negative entries
retroAmount         = Σ paidValue ของ Retro entries
netPay = (regularAmount + otAmount + accommodationAmount + retroAmount)
        - (deductionAmount + ssoAmount + slfAmount + otherDeduction)

DRIVER:
basePay จาก `_buildDriverSummary()` (monthlyRate − absenceDeduction หรือโหมดรายวัน)
regularAmount = basePay (REGULAR entries ของ driver paidValue = 0)
netPay = สูตรเดียวกัน แล้ว **clamp ที่ 0**
deductionAmount เก็บเฉพาะ correction/เรียกคืน — การหักขาดอยู่ใน absenceDeduction (แยก)
```

## workingDays

```
WORKER = regularEffectiveMinutes / 480
         (รวมนาทีลา + วันหยุด×480 — holiday = 1 วันทำงานเต็มวันตามระบบ "แรง")
DRIVER = จำนวนวันที่มี REGULAR entry (วันมาทำงานจริง)
```

## overtimeMinutes

แยกตาม otRate `{ "1", "1.5", "2", "3" }` — นาทีของ OVERTIME entries (ไม่หักพัก)
(driver จริงๆ มีแค่ 1/1.5/3 — ตัว 2 เป็นของ worker holiday_2x)

## Summary object ที่ return

```javascript
{
    // ร่วม
    dailyRate, regularAmount, otAmount, accommodationAmount,
    deductionAmount, retroAmount, workingDays, overtimeMinutes, netPay,

    // WORKER เพิ่ม
    holidayDays,        // จำนวนวันนักขัตฤกษ์ในรอบ (≥ startDate)
    holidayAmount,      // เงิน holiday pay (รวมอยู่ใน regularAmount แล้ว)
    leaveOnlyMinutes,   // นาทีลาของวันที่ไม่มี entry
    leaveOnlyAmount,    // เงินค่าจ้างวันลา (รวมอยู่ใน regularAmount แล้ว)

    // DRIVER เพิ่ม
    payMode,            // 'MONTHLY' | 'DAILY' (เข้าใหม่กลางเดือน)
    monthlyRate,        // rate ณ วันสุดท้ายของรอบ
    absentMinutes,      // ชั่วโมงขาดสะสม (แสดงผลแปลงเป็น "X วัน Y ชม. Z นาที" ที่ frontend)
    absenceDeduction,   // เงินหักขาด (ย่อยหน่วย)
    basePay,            // ค่าจ้างที่ต้องจ่าย (= regularAmount)
    netDays,            // โหมด DAILY: จำนวนวันสุทธิ (null ถ้า MONTHLY)
}
```

## หมายเหตุสถาปัตยกรรม

- holiday pay และค่าจ้างวันลา (ไม่มี entry) **คำนวณสดตอนอ่าน** — แก้ตาราง Holiday/Leave
  หลังทำจ่ายแล้ว สรุปยอดจะเปลี่ยนตาม (ไม่ snapshot)
- นาทีลาของวันที่มี entry ถูก top-up เข้า paidValue **ตอนทำจ่าย** (snapshot ตาม entry)
- ปัดเศษ: เงิน 2 ตำแหน่ง / workingDays 3 ตำแหน่ง
