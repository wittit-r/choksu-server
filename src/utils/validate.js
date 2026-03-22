import Joi from 'joi';
import err from './error.js';
import object from './object.js';

// =====================================================
// Joi Extensions - Custom Types
// =====================================================

const CustomJoi = Joi.extend((joi) => ({
    type: 'phone',
    base: joi.string(),
    messages: {
        'phone.invalid': '{{#label}} must start with 0 and have 9-10 digits'
    },
    validate(value, helpers) {
        // เช็คค่าว่าง → ให้ Joi จัดการ required/optional เอง (อย่า return value)
        if (value === undefined || value === null || value === '') {
            return; // ไม่ return อะไรเลย → ให้ base string type จัดการต่อ
        }

        // เช็ครูปแบบเบอร์โทรไทย: 0xxxxxxxxx (9-10 ตัว)
        if (!value.match(/^0\d{8,}$/)) {
            return { value, errors: helpers.error('phone.invalid') };
        }

        return { value };
    }
})).extend({
    type: 'time',
    base: Joi.string(),
    messages: {
        'time.base': '{{#label}} must be in HH:mm:ss format'
    },
    validate(value, helpers) {
        // เช็คค่าว่าง → ให้ Joi จัดการ required/optional เอง
        if (value === undefined || value === null || value === '') {
            return;
        }

        // ตรวจสอบ HH:mm:ss (รองรับ 00:00:00 - 24:00:00)
        if (!value.match(/^([01]?[0-9]|2[0-4]):[0-5][0-9]:[0-5][0-9]$/)) {
            return { value, errors: helpers.error('time.base') };
        }

        return { value };
    }
}).extend({
    type: 'thaiId',
    base: Joi.string(),
    messages: {
        'thaiId.base': '{{#label}} must be exactly 13 digits'
    },
    validate(value, helpers) {
        // เช็คค่าว่าง → ให้ Joi จัดการ required/optional เอง
        if (value === undefined || value === null || value === '') {
            return;
        }

        // ตรวจสอบเลขบัตรประชาชนไทย: 13 หลัก
        if (!value.match(/^\d{13}$/)) {
            return { value, errors: helpers.error('thaiId.base') };
        }

        return { value };
    }
});

// =====================================================
// Validate Function
// =====================================================

/**
 * แปลง Joi error.details เป็นรูปแบบง่ายๆ
 * จาก: [{ message: '...', path: ['name'] }, ...]
 * เป็น: { name: '...', email: '...' }
 *
 * @param {Array} details - Joi error.details
 * @param {boolean} simple - true = ใช้ field name เป็น key, false = ใช้ path เป็น key
 * @returns {Object} รูปแบบ errors ที่ง่ายขึ้น
 */
const simplifyJoiErrors = (details, simple = true) => {
    const errors = {};

    for (const detail of details) {
        // ดึงชื่อ field จาก path
        const key = simple
            ? detail.path[0]  // เอแค่ตัวแรก (เช่น 'name', 'email')
            : detail.path.join('.'); // เอาทั้ง path (เช่น 'address.city')

        // ใช้ message ต้นทางของ Joi
        errors[key] = detail.message.replace(/["]/g, '');
    }

    return errors;
};

/**
 * Validate input using Joi schema
 * Auto coerces types + whitelists (drops unknown fields)
 *
 * @param {*} input - ข้อมูลที่ต้องการ validate
 * @param {Joi.Schema} schema - Joi schema
 * @param {Object} options - Joi options (optional)
 * @returns {Object} ข้อมูลที่ validate ผ่านแล้ว (coerced + whitelisted)
 * @throws {Error} HttpError 400 ถ้า validation fail
 */
const validate = (input, schema, options = {}) => {
    // Deep trim input ก่อน validate (ตัดช่องว่างหน้าหลัง)
    input = object.deepTrim(input || {});

    // Default options
    const defaultOptions = {
        stripUnknown: true, // ✅ Whitelist - drop unknown fields
        convert: true, // ✅ Coerce - string→number/boolean
        abortEarly: false, // แสดง errors ทั้งหมด
    };

    // Merge options
    const opts = { ...defaultOptions, ...options };

    // Validate
    const { error, value } = schema.validate(input, opts);

    // ถ้า fail ให้ throw error
    if (error) {
        // ✅ แปลง error.details ให้เป็นรูปแบบง่ายๆ
        const simpleErrors = simplifyJoiErrors(error.details, false);
        throw err.validation(simpleErrors);
    }

    // Return ข้อมูลที่ผ่าน (coerced + whitelisted แล้ว)
    return value;
};

export {
    validate,
    CustomJoi as Joi
};
