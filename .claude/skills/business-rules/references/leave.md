# ระบบวันลา / สิทธิ์ / วันหยุดนักขัตฤกษ์

> Implement แล้วใน branch `feature/payroll-leave-v2` (3 พ.ย. 2026) — spec เต็ม: `docs/PAYROLL-LEAVE-SPEC-DRAFT.md`

## Models

```
Holiday           holidayDate (DATE เที่ยงคืนไทย, unique), name — กรอกมือต่อปี
LeaveType         name (unique), defaultDaysPerYear, isActive — ผู้ใช้แก้ได้เอง
                  seed: ลาป่วย 30 / พักร้อน 7 / ลากิจ 3
Leave             employeeId, leaveTypeId, startTime, endTime, note — 1 รายการ = 1 วัน + ช่วงเวลา
LeaveEntitlement  employeeId, year, leaveTypeId, entitledDays — unique 3 ฟิลด์ (snapshot รายปี)
```

## กติกาสิทธิ์

- นับตาม **ปีปฏิทิน** ไม่สะสมข้ามปี
- **คำนวณสด**: ยอดคงเหลือ = entitled − Σ นาทีลา (จากตาราง Leave) — ไม่เก็บ usedDays ซ้ำ
- หน่วยภายในเป็น **นาที** (`entitledDays × 480`) — 1 วัน = 480 นาที
- Prorata คนเข้ากลางปี: `ceil(defaultDaysPerYear × เดือนที่เหลือ / 12)` — เดือนที่เริ่ม = เดือนแรก
- Enforce: **block เฉพาะเกินยอดคงเหลือทั้งปี** (สัดส่วนรายเดือนไม่บล็อก — ดุลยพินิจหัวหน้า)
- ปีที่ยังไม่ generate → ลาไม่ได้ (422 "ต้อง generate ก่อน")
- แก้สิทธิ์รายคนได้ตลอดปี — ต่ำกว่าที่ใช้ไปแล้วได้ (ยอดติดลบ = ลาต่อไม่ได้จนปรับ)
- `POST /leave-entitlements/generate {year}` — idempotent สร้างเฉพาะ row ที่ขาด

## Validation การบันทึกลา (`leave.service.createLeave`)

1. ช่วงเวลาถูกต้อง (timeIn < timeOut, วันเดียวต่อรายการ)
2. พนักงานกะ (`Employee.shiftType = SHIFT`) ลาได้ทั้ง 24 ชม. / ปกติได้เฉพาะ **08:00–17:00**
3. **ห้ามลาในวันหยุดนักขัตฤกษ์** (เทียบตาราง Holiday)
4. ห้ามซ้อนทับกับ Leave อื่น (409)
5. ห้ามซ้อนทับกับ TimeEntry REGULAR/OVERTIME (409)
6. work + leave ของวันนั้น ≤ **480 นาที** (เกินต้องแยกเป็น OT)
   — พนักงานปกติ (หน้าต่าง 08:00–17:00) รวมไม่พ้น 480 ทางโครงสร้าง กติกานี้มีผลจริงกับพนักงานกะ
7. ห้ามเกินสิทธิ์คงเหลือ (block — เกิน = วันนั้นกลายเป็นขาดงาน)

**นาทีลา**: หักพักกลางวัน 12:00–13:00 ถ้าคร่อม — ใช้ `effectiveMinutes()` เดียวกับนาทีทำงาน
**ลาย้อนหลัง**: ได้ทุกวัน — ผลเงินเข้ารอบถัดไป (คำนวณสด ไม่ย้อนแก้รอบที่จ่ายแล้ว)

## ผลต่อเงิน

| | WORKER | DRIVER |
|---|---|---|
| นาทีลาของวันที่มี entry | เติมเข้า paidValue วันนั้น (work+leave ≥480 = dailyRate) | ลดชั่วโมงขาดของวันนั้น |
| วันลาที่ไม่มี entry | จ่ายที่สรุปยอด (leaveOnlyAmount) + เกิด payroll แม้ไม่มี entry | ไม่นับขาด |

## Snapshot semantics (การแก้กลางปี)

- แก้ `defaultDaysPerYear` → มีผลกับ generation ครั้งถัดไปเท่านั้น
- เปลี่ยนสิทธิ์ทั้งบริษัทกลางปี (เช่น กฎหมายเปลี่ยน) = script ad-hoc นอกระบบ (เคสหายาก)
- ห้ามลบ LeaveType ที่ถูกอ้าง → ใช้ `isActive=false` ปิดแทน

## Endpoints

```
GET/POST/DELETE   /holidays            (paginated GET ?year&page&limit)
GET/POST/PATCH/DELETE /leave-types     (paginated; DELETE บล็อกถ้าถูกอ้าง)
GET/POST/DELETE   /leaves              (?employeeId&year&month)
GET               /leave-entitlements  (?employeeId&year — พร้อมยอดคงเหลือคำนวณสด)
PATCH             /leave-entitlements/:id   (แก้ entitledDays รายคน)
POST              /leave-entitlements/generate
```
