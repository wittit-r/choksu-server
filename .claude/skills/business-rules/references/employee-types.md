# ประเภทพนักงาน (EmployeeType)

## WORKER — พนักงานรายวัน

- จ่ายเป็น **รายวัน** (dailyRate)
- มีรอบจ่าย **24 รอบ/ปี** (ประมาณ 2 ครั้งต่อเดือน)
- ใช้ TimeSheet แบบ **DAILY** (ลงเวลาทีละวัน ต่อ workLeader)
- ใช้ dailyRate, hourlyRate, minuteRate ในการคำนวณ
- มีเวลาพักกลางวัน (lunch break) สำหรับ shiftType REGULAR

## DRIVER — พนักงานขับรถ

- จ่ายเป็น **รายเดือน** (monthlyRate)
- มีรอบจ่าย **12 รอบ/ปี** (รายเดือน)
- ใช้ TimeSheet แบบ **MONTHLY** (ลงเวลารวมทั้งเดือน ต่อ employee)
- ใช้ dailyRate, hourlyRate, minuteRate เหมือน WORKER ในการคำนวณ OT
- **ไม่มี** เวลาพักกลางวัน (shiftType เป็น REGULAR เสมอ)

## ความแตกต่าง

| | WORKER | DRIVER |
|---|---|---|
| รอบจ่าย | 24 รอบ/ปี | 12 รอบ/ปี |
| TimeSheet | DAILY (ต่อ workLeader) | MONTHLY (ต่อ employee) |
| Lunch break | มี (shiftType REGULAR) | ไม่มี |
| ค่าจ้างหลัก | dailyRate | monthlyRate |
| OT คำนวณ | dailyRate/hourlyRate/minuteRate | dailyRate/hourlyRate/minuteRate (เหมือนกัน) |
