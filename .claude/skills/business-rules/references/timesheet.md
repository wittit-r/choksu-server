# TimeSheet & TimeEntry

## Data Model

### TimeSheet (table: `time_sheets`)

Unified model รองรับ 2 ประเภท: **DAILY** (Worker) และ **MONTHLY** (Driver)

| Field | Type | DAILY | MONTHLY | Notes |
|-------|------|-------|---------|-------|
| id | Int (PK, auto) | ✓ | ✓ | |
| workLeaderId | Int? | ✓ | - | FK → WorkLeader |
| workDate | DateTime? | ✓ | - | วันทำงาน |
| employeeId | Int? | - | ✓ | FK → Employee |
| monthPeriod | String? | - | ✓ | "YYYY-MM" |
| sheetType | Enum | DAILY | MONTHLY | |
| status | Enum | PENDING/FILLED | PENDING/FILLED | |
| createBy | Int | ✓ | ✓ | FK → User |
| files | Json? | ✓ | ✓ | Array of S3 paths |
| timeEntries | Relation | ✓ | ✓ | onDelete: Cascade |

### TimeEntry (table: `time_entries`)

| Field | Type | Notes |
|-------|------|-------|
| id | Int (PK, auto) | |
| timeSheetId | Int | FK → TimeSheet (cascade delete) |
| employeeId | Int | FK → Employee |
| startTime | DateTime | ACCOMMODATION = `combineDateAndTime(date, '00:00:00')` |
| endTime | DateTime? | ACCOMMODATION = null |
| shiftType | Enum | REGULAR, SHIFT |
| workType | Enum | REGULAR, OVERTIME, ACCOMMODATION |
| otRate | Decimal(3,1) | ตัวคูณ OT: 0, 1, 1.5, 2, 3 |
| accommodation | Decimal(12,2) | ค่าที่พัก |
| isNegative | Boolean | รายการติดลบ (correction) |
| isRetro | Boolean | รายการจ่ายเพิ่มย้อนหลัง |
| status | Enum | DRAFT, LOCKED |
| referenceEntryId | Int? | ID entry เดิม (correction/retro) |
| paidValue | Decimal? | ยอดที่คำนวณได้ (snapshot) |
| paidDate | DateTime? | วันที่จ่าย |
| billDate | DateTime? | วันที่เบิก |
| note | String? | หมายเหตุ |

---

## Worker vs Driver: สรุปความแตกต่าง

| aspect | Worker (DAILY) | Driver (MONTHLY) |
|--------|---------------|-------------------|
| **Scope** | Team (workLeaderId + workDate) | Individual (employeeId + monthPeriod) |
| **Pattern** | Shared ร่วมกันทั้ง timesheet | ระบุ per-entry |
| **workType** | กำหนดจาก pattern (REGULAR/OVERTIME) | ระบุเอง (REGULAR/OVERTIME/ACCOMMODATION) |
| **shiftType** | REGULAR หรือ SHIFT | REGULAR เสมอ |
| **Accommodation** | ไม่รองรับโดยตรง | รองรับ |
| **Add entry** | ใช้ pattern จาก entry แรก | ระบุ workType/otRate/accommodation |
| **Edit entry** | แก้ได้แค่ timeIn/timeOut/shiftType/note | แก้ timeIn/timeOut/otRate/accommodation/note |
| **Duplicate check** | workLeaderId + workDate | employeeId + monthPeriod |

---

## Use Cases

### UC-1: สร้าง Worker Timesheet (ปกติ)

1. เลือก work leader + วันทำงาน
2. เลือก pattern (regular หรือ OT + otRate)
3. เพิ่ม entries ของพนักงานในทีม (timeIn/timeOut per employee)
4. ส่งด้วย `allowDuplicate: false`
5. Backend สร้าง TimeSheet + TimeEntries ใน transaction เดียว

### UC-2: 1 Work Leader หลาย Timesheet ในวันเดียวกัน

**Scenario:** หัวหน้างานคนเดียวกันดูแล 2 shift (เช้า + กลางคืน) พนักงานคนละช่วงเวลา ไม่ซ้อนทับ

1. สร้าง timesheet แรก (shift เช้า) → สำเร็จ
2. สร้าง timesheet ที่สอง (shift กลางคืน) → CONFLICT
3. Frontend แสดง toast "ยืนยันสร้างซ้ำ"
4. ส่งใหม่ด้วย `allowDuplicate: true`
5. `_validateNoOverlaps()` ตรวจว่าเวลาพนักงานไม่ซ้อนทับข้าม timesheet → สำเร็จ

**สำคัญ:** Overlap validation ตรวจข้าม timesheet ทั้งหมดใน DB ไม่ใช่แค่ใน timesheet เดียวกัน

### UC-3: Correction (แก้ไขย้อนหลังหลังจ่ายเงินแล้ว)

**Scenario:** พนักงานทำงาน 08:00-17:00 แต่จ่ายเงินไปแล้ว ต้องการแก้เป็น 08:00-15:00

1. เลือก entry เดิม (paidDate !== null)
2. ระบุช่วงที่ต้องการหักออก: 15:00-17:00
3. Backend สร้าง negative entry (isNegative: true, referenceEntryId: originalEntry.id)
4. Negative entry copy shiftType, workType, otRate จาก entry เดิม
5. เวลาต้องอยู่ในช่วง entry เดิมเท่านั้น

### UC-4: เพิ่ม Entry ใน Timesheet ที่มีอยู่

**Worker (DAILY):**
- ใช้ pattern จาก entry แรกใน timesheet (ห้ามเปลี่ยน)
- ระบุ employeeId, timeIn, timeOut, shiftType
- ระบบตรวจ overlap กับ entries ที่มีอยู่

**Driver (MONTHLY):**
- ระบุ workType, otRate, accommodation เอง
- แต่ละ entry เป็นอิสระจากกัน

### UC-5: ลบ Entry

**Positive entry:**
- timesheet ต้องเป็น PENDING
- entry ต้องยังไม่จ่ายเงิน

**Negative entry (correction):**
- ต้องยังไม่จ่ายเงิน
- ลบได้แม้ timesheet จะ FILLED (เพราะ correction สร้างหลังยืนยันได้)

### UC-6: แก้ไข Entry

**Worker:** แก้ได้แค่ timeIn, timeOut, shiftType, note (ห้ามเปลี่ยน workType/otRate)
**Driver:** แก้ timeIn, timeOut, otRate, accommodation, note ได้ (ห้ามเปลี่ยน workType)

ทั้งสองประเภท: timesheet ต้องไม่เป็น FILLED

---

## Delete Rules

| สิ่งที่จะลบ | เงื่อนไข |
|-------------|---------|
| TimeSheet | ต้องเป็น PENDING เท่านั้น (cascade delete entries) |
| TimeEntry (positive) | timesheet ต้องไม่ FILLED, entry ต้องยังไม่จ่ายเงิน |
| TimeEntry (negative) | ต้องยังไม่จ่ายเงิน แต่ลบได้แม้ timesheet จะ FILLED |
