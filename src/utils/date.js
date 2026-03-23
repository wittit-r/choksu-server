/**
 * รวม Date object กับ time string (HH:mm:ss) เป็น DateTime
 * @param {Date|string} date - Date object หรือ string YYYY-MM-DD
 * @param {string} timeStr - เวลาในรูปแบบ "HH:mm:ss" (เวลาไทย)
 * @returns {Date} DateTime object
 */
const combineDateAndTime = (date, timeStr) => {
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);

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

    // รองรับ 24:00:00 → เปลี่ยนเป็น 00:00:00 ของวันถัดไป
    if (hours === 24) {
        const nextDay = new Date(year, month, day + 1);
        return new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate(), 0, minutes, seconds, 0);
    }

    // สร้าง Date ใหม่ด้วย local components (ไม่ใช้ setHours เพราะอาจมี side effect)
    return new Date(year, month, day, hours, minutes, seconds, 0);
};

/**
 * แปลง Date object เป็น string วันที่ (เวลาไทย)
 * @param {Date} date - Date object
 * @returns {string} วันที่ในรูปแบบ "YYYY-MM-DD"
 */
const toLocalDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * แปลง Date object เป็น string เวลา (เวลาไทย)
 * @param {Date} date - Date object
 * @param {boolean} [withSecond=false] - แสดงวินาทีด้วยหรือไม่
 * @returns {string} เวลาในรูปแบบ "HH:mm" หรือ "HH:mm:ss"
 */
const toLocalTime = (date, withSecond = false) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    if (withSecond) {
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }
    return `${hours}:${minutes}`;
};

/**
 * แปลงนาทีเป็น string ชั่วโมง:นาที
 * @param {number} minutes - จำนวนนาที
 * @returns {string} ชั่วโมงในรูปแบบ "H:mm"
 */
const formatMinutesToHours = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${String(mins).padStart(2, '0')}`;
};

export { combineDateAndTime, toLocalDate, toLocalTime, formatMinutesToHours };