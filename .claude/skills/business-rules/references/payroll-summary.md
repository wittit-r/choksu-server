# Payroll Summary — สรุปยอดจ่าย

ฟังก์ชันหลัก: `_buildPayrollSummary(payroll, dailyRate)` ใน `src/services/pay-period.service.js`

## สูตร netPay

```
regularAmount       = ผลรวม paidValue ของ REGULAR entries
otAmount            = ผลรวม paidValue ของ OVERTIME entries
accommodationAmount = ผลรวม paidValue ของ ACCOMMODATION entries
deductionAmount     = ผลรวม |paidValue| ของ Negative entries (ค่าบวก)
retroAmount         = ผลรวม paidValue ของ Retro entries

netPay = (regularAmount + otAmount + accommodationAmount + retroAmount)
        - (deductionAmount + ssoAmount + slfAmount + otherDeduction)
```

## workingDays

```
workingDays = regularEffectiveMinutes / 480
```

คำนวณจาก effective minutes รวมของ REGULAR entries (หลังหักพักกลางวัน)
ใช้ `Math.round(value * 1000) / 1000` (ทศนิยม 3 ตำแหน่ง)

## overtimeMinutes

แยกตาม otRate:
```
{
  "1": 0,     // OT × 1 รวมกี่นาที
  "1.5": 0,   // OT × 1.5 รวมกี่นาที
  "2": 0,     // OT × 2 รวมกี่นาที
  "3": 0      // OT × 3 รวมกี่นาที
}
```

คำนวณจาก totalMinutes ของ OVERTIME entries (ไม่หักพักกลางวัน)

## Summary object ที่ return

```javascript
{
    dailyRate,            // อัตราค่าจ้างรายวัน (จาก _getPrimaryWageRates)
    regularAmount,        // Math.round(× 100) / 100
    otAmount,             // Math.round(× 100) / 100
    accommodationAmount,  // Math.round(× 100) / 100
    deductionAmount,      // Math.round(× 100) / 100
    retroAmount,          // Math.round(× 100) / 100
    workingDays,          // Math.round(× 1000) / 1000
    overtimeMinutes,      // { "1": 0, "1.5": 0, "2": 0, "3": 0 }
    netPay,               // Math.round(× 100) / 100
}
```
