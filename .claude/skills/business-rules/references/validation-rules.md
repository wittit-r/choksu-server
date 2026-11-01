# Validation Rules — กฎการตรวจสอบ

## TimeEntry Overlap (ทับซ้อนเวลา)

ฟังก์ชัน: `_validateNoOverlaps(entries, excludeEntryIds, tx)` ใน `src/services/timesheet.service.js`

```
ตรวจสอบว่า: start1 < end2 AND end1 > start2
```

- ตรวจสอบระหว่าง entries ใหม่เอง (INTERNAL_OVERLAP)
- ตรวจสอบกับ entries ที่มีอยู่ใน DB (DATABASE_OVERLAP)
- ตรวจเฉพาะ REGULAR และ OVERTIME (ACCOMMODATION ไม่มีเวลา)
- สามารถยกเว้น entry IDs ได้ (สำหรับ update)
- Group ตรวจสอบระหว่าง employee เดียวกันเท่านั้น

---

## ACCOMMODATION Duplicate

ฟังก์ชัน: `_validateNoAccommodationDuplicates(employeeId, monthPeriod, dates, excludeEntryIds, tx)`

- ตรวจสอบว่าไม่มี ACCOMMODATION ซ้ำในเดือนเดียวกัน (monthPeriod)
- ตรวจทั้งภายในข้อมูลที่ส่งมา (internal duplicates) และใน DB
- สามารถยกเว้น entry IDs ได้ (สำหรับ update)

---

## TimeSheet Duplicate

- **DAILY**: ห้ามมี workLeaderId + workDate ซ้ำ (เว้น allowDuplicate=true)
- **MONTHLY**: ห้ามมี employeeId + monthPeriod ซ้ำ (เว้น allowDuplicate=true)

---

## Negative Entry Rules

- ต้องมี originalEntryId ที่มีอยู่จริง
- originalEntry ต้องอยู่ใน timeSheet **เดียวกัน**
- ห้ามสร้าง negative ของ entry ที่เป็น negative เอง
- originalEntry ต้องจ่ายเงินแล้ว (`paidDate != null`)
- ช่วงเวลาต้องอยู่ **ภายใน** originalEntry
- ห้ามทับซ้อนกับ negative อื่นของ originalEntry เดียวกัน

---

## TimeSheet Status Rules

- **FILLED**: ห้ามเพิ่ม/แก้/ลบ TimeEntry ปกติ
- **FILLED**: ยังสามารถสร้าง negative entry ได้ (แก้ไขย้อนหลัง)
- **PENDING**: ลบ TimeSheet ได้ → Cascade ลบ entries ด้วย

---

## WorkType Rules

| WorkType | otRate | accommodation | ต้องมีเวลา |
|---|---|---|---|
| `REGULAR` | ต้องเป็น 0 | ต้องเป็น 0 | ใช่ |
| `OVERTIME` | ต้อง > 0 | ต้องเป็น 0 | ใช่ |
| `ACCOMMODATION` | ต้องเป็น 0 | ต้อง > 0 | ไม่ใช่ |

---

## Edge Cases

### 1. เปลี่ยน WageRate กลางรอบจ่าย

ระบบรองรับอยู่แล้ว เพราะ `_getWageRatesByDate()` สร้าง Map ตามวันที่
แต่ต้องแน่ใจว่า WageRate ใหม่มี `effectiveFrom` และ `effectiveTo` ถูกต้อง

### 2. Negative entry ที่ทับซ้อนกับ payroll อื่น

ระบบไม่ตรวจสอบว่า negative entry ของ entry ที่ถูกจ่ายในรอบอื่น
→ ต้องระวังเมื่อสร้าง negative หลังจาก export/calculate

### 3. Retroactive ที่ entry เดิมถูกหักล้าง

`calculateRetroactive()` รวม negative entries ในการคำนวณ netMinutes แล้ว
→ ไม่ต้องกังวลเรื่องนี้

### 4. TimeEntry ที่ LOCKED แล้วถูกคืน

เมื่อยกเลิก Payroll → TimeEntry กลับเป็น DRAFT, paidValue = null
แต่ **negative entries และ retro entries จะไม่ถูกคืน** (ไม่ได้ linked กับ PayrollRelate)

### 5. ปัดเศษเงิน

- เงิน: `Math.round(value * 100) / 100` (ทศนิยม 2 ตำแหน่ง)
- workingDays: `Math.round(value * 1000) / 1000` (ทศนิยม 3 ตำแหน่ง)
