/**
 * รวม Date object กับ time string (HH:mm) เป็น DateTime
 * @param {Date|string} date - Date object หรือ string YYYY-MM-DD
 * @param {string} timeStr - เวลาในรูปแบบ "HH:mm" (เวลาไทย)
 * @returns {Date} DateTime object
 */
const combineDateAndTime = (date, timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // ถ้าเป็น string YYYY-MM-DD ให้แยกเอา
    let year, month, day;
    if (typeof date === 'string') {
        [year, month, day] = date.split('-').map(Number);
        month -= 1; // JS month เริ่มจาก 0
    } else {
        // ถ้าเป็น Date object ให้ดึงจาก local time
        year = date.getFullYear();
        month = date.getMonth();
        day = date.getDate();
    }

    // รองรับ 24:00 → เปลี่ยนเป็น 00:00 ของวันถัดไป
    if (hours === 24) {
        const nextDay = new Date(year, month, day + 1);
        return new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate(), 0, minutes, 0, 0);
    }
    
    // สร้าง Date ใหม่ด้วย local components (ไม่ใช้ setHours เพราะอาจมี side effect)
    return new Date(year, month, day, hours, minutes, 0, 0);
};

export { combineDateAndTime };