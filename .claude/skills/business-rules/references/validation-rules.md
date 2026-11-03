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

---

## วันลา (Leave) — `leave.service.createLeave`

validation 7 ข้อ (เรียงตามลำดับตรวจ): รายละเอียดเต็มดู [leave.md](leave.md)

1. ช่วงเวลาถูกต้อง: timeIn < timeOut (1 รายการ = 1 วัน)
2. ช่วงเวลาลา: กะ (SHIFT) ได้ทั้ง 24 ชม. / ปกติเฉพาะ 08:00–17:00 (422)
3. ห้ามลาในวันหยุดนักขัตฤกษ์ (422 — เทียบตาราง Holiday)
4. ห้ามซ้อนทับกับ Leave อื่น (409)
5. ห้ามซ้อนทับกับ TimeEntry REGULAR/OVERTIME (409)
6. work + leave ≤ 480 นาที/วัน — เกินต้องแยกเป็น OT (422)
   (พนักงานปกติรวมไม่พ้น 480 ทางโครงสร้าง — มีผลจริงเฉพาะพนักงานกะ)
7. ห้ามเกินสิทธิ์คงเหลือทั้งปี (422 block) / ปีที่ยังไม่ generate สิทธิ์ = ลาไม่ได้

---

## Worker pattern ในวันนักขัตฤกษ์

- สร้าง worker timesheet วันที่ตรงวันหยุดนักขัตฤกษ์: อนุญาตเฉพาะ pattern
  `holiday_2x` / `holiday_3x` ({regular: false, ot ≥ 2}) — pattern ปกติ/OT 1×/1.5× → 422

## OT window ของ DRIVER

- OT entry (สร้าง/เพิ่ม/แก้) ต้องอยู่**นอก** 08:00–17:00 ของวัน จันทร์–เสาร์ (422)
- วันอาทิตย์/นักขัตฤกษ์ → OT ได้ทุกช่วง
- คร่อมข้ามวัน: ส่วนก่อนเที่ยงคืนต้องเริ่ม ≥ 17:00

## PayPeriod วันที่

- API รับ startDate/endDate เป็น **string "YYYY-MM-DD"** แล้วแปลงเป็นเที่ยงคืนเวลาไทย
  (ห้าม Joi `.date().iso()` — date-only จะถูก parse เป็น UTC → เก็บเพี้ยน 07:00)
- เทียบ entry/leave กับปลายรอบใช้ `[Op.lt]: nextMidnight(endDate)` เสมอ
  (`[lte endDate]` จะทำ entry ของวันสุดท้ายหลุด)

## Driver REGULAR ในวันหยุด (เพิ่ม 3 พ.ย. 2026)

- วันที่ "ไม่มีเวลาทำงานปกติ" = **อาทิตย์ + วันหยุดนักขัตฤกษ์**
- driver ลง REGULAR ในวันเหล่านี้ → **422** (ลงได้แค่ OT + ค่าที่พัก)
- เช็คทุก path: create ทั้งเดือน / add entry / update entry (`_validateDriverRegularDay`)
- เหตุผล: วันหยุดไม่มีชั่วโมงคาดหวัง — REGULAR ไม่มีผลต่อเงิน (monthlyRate ครอบอยู่)
  ลงไปได้แค่ข้อมูลหลอก / frontend แสดงแถว "หยุด" + ชื่อวันหยุด ล็อกช่องเวลาปกติ
