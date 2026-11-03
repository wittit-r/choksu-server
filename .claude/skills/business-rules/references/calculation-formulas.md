# สูตรคำนวณเงิน — หัวใจของระบบ

จุดเริ่ม: `_calculatePayrollAmounts()` (paidValue ราย entry) + `_buildPayrollSummary()` (สรุปยอด)
ใน `src/services/pay-period.service.js` — util กลางนาที: `effectiveMinutes(start, end, {lunch})`
ใน `src/utils/work-time.js` (หักพัก 12:00–13:00 ถ้าคร่อม — ใช้ร่วมทั้งนาทีทำงาน/นาทีลา/ชั่วโมงทำจริง driver)

---

## WORKER — REGULAR (คิด "ต่อวัน")

```
นาทีของวัน = Σ effectiveMinutes(entries ของวันนั้น, lunch: shiftType=REGULAR)
            + นาทีลาของวันนั้น (จากตาราง Leave, หักพักแล้ว)

≥ 480 นาที (8 ชม.) → paidValue = dailyRate (เต็มวัน)
< 480 นาที        → paidValue = ชม.เต็ม × hourlyRate + นาทีเศษ × minuteRate (ย่อยหน่วย)
```

- วันที่มีหลาย REGULAR entry → รวมเป็นวันเดียว จ่ายที่ entry แรก (ตัวที่เหลือ paidValue 0)
- rate ใช้ WageRate ณ วันนั้น (history) — retroactive จัดการกรณีปรับเรท

**ตัวอย่าง**: ทำ 08:00–15:00 (360) + ลา 15:00–17:00 (120) = 480 → dailyRate เต็มวัน
**ตัวอย่าง**: ทำ 08:00–12:00 (240) + ลา 13:00–15:00 (120) = 360 → 6×hourlyRate

### Holiday pay (วันหยุดนักขัตฤกษ์ — คำนวณสดตอนอ่านสรุปยอด)

- ทุกวันนักขัตฤกษ์ในรอบ (≥ employee.startDate) → **+ dailyRate ณ วันนั้น อัตโนมัติ**
- มาทำงานวันนักขัตฤกษ์ → ต้องลง pattern `holiday_2x`/`holiday_3x` เท่านั้น (entry คิดแบบ OT)
  และยังได้ holiday pay 1× **ซ้อนอีกชั้น** (รวม ≈ 3×)
- ห้ามลง pattern ปกติในวันนักขัตฤกษ์ (backend reject 422)

### วันลาที่ไม่มี entry เลย (ลาเต็มวันไม่มาทำงาน)

ไม่มี entry ให้ยึด paidValue → จ่ายตอนอ่านสรุปยอด (`leaveOnlyAmount`) ด้วยเกณฑ์ 480 เดียวกัน
และ payroll ของ worker เกิดแม้คนนั้นจะมีแต่วันลาไม่มี entry เลย

---

## DRIVER — เงินพื้นฐานรายเดือน (spec ใหม่)

```
เงินพื้นฐาน = monthlyRate (WageRate ณ วันสุดท้ายของรอบ)

วันที่มี "ชั่วโมงคาดหวัง" = จันทร์–เสาร์ (ไม่ใช่อาทิตย์/นักขัตฤกษ์/ก่อน startDate)
ชั่วโมงขาด = Σ ทุกวันคาดหวัง: max(0, 480 − ชั่วโมงทำจริงหักพัก − นาทีลา)
  (REGULAR entry ของ driver ใช้แค่นับชั่วโมงทำจริง — paidValue = 0)
  (correction ติดลบของ REGULAR = ลดนาทีทำจริงของวันนั้น → เพิ่มชั่วโมงขาด)

absenceDeduction = ย่อยหน่วยจากชั่วโมงขาด (rate ณ วันสุดท้ายของรอบ):
    จำนวนวันเต็ม × dailyRate + ชม.เต็ม × hourlyRate + นาที × minuteRate
    (ขาด 2 วัน 3 ชม. 10 นาที = 2×daily + 3×hourly + 10×minute)

basePay = monthlyRate − absenceDeduction        (โหมด MONTHLY)
basePay = วันสุทธิ × dailyRate รายวัน           (โหมด DAILY — เข้าใหม่กลางเดือน)
          วันสุทธิ = วันที่มี entry + วันลา + วันนักขัตฤกษ์ (จ–ส นับแต่ startDate)

ยอดจ่ายสุดท้าย (netPay) clamp ที่ 0 — ติดลบไม่ได้
```

**Golden cases จากแผ่นจ่ายจริง** (ใช้เป็น expected ใน tests ได้):
- เดือนเต็มไม่ขาด + ที่พัก 2 คืน: 17,284 + 800 = **18,084.00**
- เข้าใหม่ทำ 16 วัน + OT 1× 8 ชม. + ที่พัก 4: 16×576.13 + 576.13 + 1,600 = **11,394.21**
- ขาด 1 วัน 6 ชม.: 13,091 − (436.37 + 6×54.55) = **12,327.33**
- OT 1× 1 ชม. + OT 3× 4 ชม.: 16,304 + 67.93 + 815.16 = **17,187.09**

---

## OVERTIME (สูตรเดิม — ทั้ง WORKER และ DRIVER)

```
totalMinutes = endTime - startTime นาที (คร่อมข้ามวัน → +24 ชม.)
≥ 480 นาที → paidValue = dailyRate × otMultiplier
< 480 นาที → paidValue = (ชม.×hourly + นาที×minute) × otMultiplier
```

- OT **ไม่หัก**พักกลางวัน
- **DRIVER: OT ได้เฉพาะนอก 08:00–17:00 ของวัน จันทร์–เสาร์** (backend validate)
  วันอาทิตย์/นักขัตฤกษ์ OT ได้ทุกช่วง (ไม่มีเวลาปกติ)
- WORKER: pattern `holiday_2x`/`holiday_3x` = ทำงานวันหยุด (คร่อมกับ holiday pay ได้)
- paidValue เป็น DECIMAL(12,2) — **ปัดต่อรายการ**ก่อนรวม (2×4 ชม. ≠ 1×8 ชม. เมื่อมีเศษ)

---

## ACCOMMODATION (เบี้ยเลี้ยงที่พัก) — DRIVER เท่านั้น

```
paidValue = accommodation (ค่าตรงๆ จากฟิลด์ — ไม่คำนวณจากเวลา)
```

---

## Negative Entry (หักล้าง/เรียกคืน)

```
WORKER: paidValue = -สูตรปกติ (REGULAR ต่อวัน หรือ OT) → เข้า deductionAmount
DRIVER REGULAR: paidValue = 0 — ผลเดินทางผ่าน "ชั่วโมงขาด" แทน (ไม่เข้า deductionAmount)
DRIVER OT/ACCOMMODATION: เหมือน WORKER
```

กฎเดิมครบ: ต้องอ้าง referenceEntryId / ช่วงอยู่ภายใน entry เดิม / ต้อง paidDate แล้ว / จ่ายรอบถัดไป

---

## Retro Entry (ยอดจ่ายย้อนหลัง)

paidValue คำนวณสำเร็จรูปตอนสร้าง (โดย `calculateRetroactive()` ใน EmployeeService)
⚠️ retroactive ของ DRIVER ยังเป็น TODO (`employee.service.js`)

---

## ปัดเศษ

- เงิน: `Math.round(value * 100) / 100` (ทศนิยม 2 ตำแหน่ง)
- workingDays: `Math.round(value * 1000) / 1000` (ทศนิยม 3 ตำแหน่ง)
