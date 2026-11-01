# Retroactive Calculation — คำนวณย้อนหลัง

ฟังก์ชันหลัก: `calculateRetroactive()` ใน `src/services/employee.service.js`

## เมื่อไหร่ต้องคำนวณย้อนหลัง?

เมื่อ **WageRate เปลี่ยน** แต่พนักงาน **จ่ายเงินไปแล้ว** ด้วยอัตราเดิม
→ ต้องคำนวณส่วนต่างและจ่ายเพิ่มในรอบต่อไป

## ขั้นตอนการคำนวณ

```
1. ดึง TimeEntry ที่:
   - paidDate ไม่เป็น null (จ่ายไปแล้ว)
   - workType เป็น REGULAR หรือ OVERTIME
   - isNegative = false, isRetro = false
   - อยู่ในช่วงวันที่ที่ระบุ

2. ดึง WageRate ปัจจุบันของพนักงาน

3. คำนวณยอดใหม่ด้วยอัตราปัจจุบัน:
   - รวม negative entries ที่หักล้าง entry เดิมไปแล้ว
   - REGULAR: netMinutes × (currentDailyRate / 480)
   - OVERTIME: netMinutes × (currentDailyRate / 480) × otRate

4. ตรวจสอบว่ามี retro entry สำหรับ entry เดิมอยู่แล้วหรือยัง (ป้องกันซ้ำ)

5. ถ้า difference > 0 → สร้าง Retro TimeEntry:
   - isRetro: true
   - referenceEntryId: ชี้ไป entry เดิม
   - paidValue: ยอดส่วนต่าง
   - note: อธิบายการปรับปรุง
```

## สิ่งที่ต้องระวัง

- ต้องคำนวณ **netMinutes** โดยหัก negative entries ที่เกี่ยวข้องออก
- REGULAR ต้องหักเวลาพักกลางวัน เหมือนสูตรปกติ (ดู [calculation-formulas.md](calculation-formulas.md))
- ต้องตรวจสอบ duplicate ก่อนสร้าง retro entry
- retro entry ที่สร้างแล้วจะมี `paidValue` อยู่แล้ว → `_calculatePayrollAmounts()` จะ skip ไม่คำนวณซ้ำ
