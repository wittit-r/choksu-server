# Wage Rate — อัตราค่าจ้าง

## โครงสร้าง

| Field | คำอธิบาย |
|---|---|
| `dailyRate` | ค่าแรงรายวัน (ใช้กับ WORKER และ OT) |
| `hourlyRate` | ค่าแรงรายชั่วโมง |
| `minuteRate` | ค่าแรงรายนาที |
| `monthlyRate` | เงินเดือน (ใช้กับ DRIVER) |
| `effectiveFrom` | วันที่เริ่มใช้อัตรานี้ |
| `effectiveTo` | วันที่สิ้นสุด (null = ใช้จนถึงปัจจุบัน) |
| `positionId` | ตำแหน่งงานที่เชื่อมโยง |

## กฎสำคัญ

- พนักงานคนเดียวสามารถมี **หลาย WageRate** ได้ (เปลี่ยนตำแหน่ง/เงินเดือน)
- ระบบหา WageRate ที่ **มีผลในช่วงวันที่** ของรอบจ่าย
- ถ้ามีหลาย rate ในช่วงเดียวกัน → เลือกอันที่ `effectiveFrom` ใกล้ที่สุดกับวันที่คำนวณ
- ถ้า effectiveTo = null → ใช้ถึง 2099-12-31

## การหา WageRate สำหรับคำนวณ

ระบบสร้าง **Map ของ date → WageRate** สำหรับทุกวันในรอบจ่าย:

```
วันที่ 1 Jan  → WageRate A (dailyRate: 400)
วันที่ 15 Jan → WageRate A
วันที่ 16 Jan → WageRate B (dailyRate: 450) ← เปลี่ยน effectiveFrom วันที่ 16
...
```

ดังนั้น ถ้ามีการเปลี่ยนเงินเดือนกลางเดือน → คำนวณแยกตามวันที่อัตโนมัติ

## ฟังก์ชันที่เกี่ยวข้อง

- `_getWageRatesByDate(employeeId, startDate, endDate, tx)` — สร้าง Map date→WageRate
  - อยู่ใน `src/services/pay-period.service.js`
- `_getPrimaryWageRates(employeeIds, periodStartDate)` — ดึง rate หลักสำหรับ summary
  - เลือก rate ล่าสุด (orderBy effectiveFrom desc) ที่มีผลในวัน periodStartDate

## การใช้ rate ในสูตร v2 (Payroll leave v2)

- **WORKER**: rate รายวันจาก Map (date → WageRate) — ค่าจ้างวันนั้นใช้ rate ของวันนั้น
- **DRIVER**: monthlyRate + rate สำหรับสูตรหักย่อยหน่วย ใช้ **rate ณ วันสุดท้ายของรอบ** (endRate)
- **เข้าใหม่กลางเดือน (โหมด DAILY)**: คิดรายวันด้วย rate ของแต่ละวัน
- การเทียบ coverage ใน `_getWageRatesByDate` เป็น**ระดับวันที่** (string YYYY-MM-DD) —
  ทนต่อค่าที่ถูกเก็บ skew 07:00 (ISO date-only ผ่าน UTC) อย่าใช้เทียบ timestamp ตรงๆ
