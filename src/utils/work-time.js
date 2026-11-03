/**
 * คำนวณนาทีทำงาน/นาทีลา โดยหักพักกลางวัน 12:00–13:00 เฉพาะช่วงที่ทับซ้อนจริง
 * (ย้ายมาจาก _calculateEntryAmount ใน pay-period.service.js เพื่อใช้ร่วม 3 บริบท:
 * ชั่วโมงทำงาน / นาทีลา / ชั่วโมงทำจริงของ driver — สูตรเดียวกันทั้งระบบ)
 *
 * @param {Date} start - เวลาเริ่ม (เวลาไทย)
 * @param {Date} end - เวลาเลิก (เวลาไทย)
 * @param {Object} [options]
 * @param {boolean} [options.lunch=true] - หักพักกลางวัน 12:00–13:00 (ส่ง false สำหรับกะ/OT)
 * @returns {number} นาทีสุทธิ (ต่ำสุด 0)
 */
const effectiveMinutes = (start, end, { lunch = true } = {}) => {
    let total = Math.round((end.getTime() - start.getTime()) / (1000 * 60));

    // กะข้ามวัน (เช่น 22:00 → 06:00) endTime ถูกบันทึกเป็นเวลาของวันเดียวกัน → บวกชดเชย 24 ชม.
    if (total < 0) total += 24 * 60;
    if (total <= 0) return 0;

    if (lunch) {
        const startMin = start.getHours() * 60 + start.getMinutes();
        const endMin = end.getHours() * 60 + end.getMinutes();
        const overlapStart = Math.max(startMin, 12 * 60);
        const overlapEnd = Math.min(endMin, 13 * 60);
        if (overlapStart < overlapEnd) {
            total -= (overlapEnd - overlapStart);
        }
    }

    return Math.max(total, 0);
};

export { effectiveMinutes };
