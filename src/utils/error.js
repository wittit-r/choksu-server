/**
 * HTTP Error Class
 * สำหรับสร้างและ throw HTTP errors แบบมีรูปแบบมาตรฐาน
 */
class HttpError extends Error {
    constructor(status, code, message, details = null) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Error Utility Class
 * วิธีใช้งาน:
 * import error from './utils/error.js';
 *
 * error.badRequest('ข้อมูลไม่ถูกต้อง');
 * error.unauthorized('กรุณาล็อกอิน');
 * error.notFound('ไม่พบพนักงาน', { employeeId: '12345' });
 * error.validation({ name: 'กรุณากรอกชื่อ' });
 */
class ErrorUtility {
    /**
     * 400 Bad Request
     */
    badRequest(details = null, message = 'ข้อมูลที่ส่งมาไม่ถูกต้อง') {
        return new HttpError(400, 'BAD_REQUEST', message, details);
    }

    /**
     * 401 Unauthorized
     */
    unauthorized(details = null, message = 'ต้องล็อกอินก่อนใช้งาน') {
        return new HttpError(401, 'UNAUTHORIZED', message, details);
    }

    /**
     * 403 Forbidden
     */
    forbidden(details = null, message = 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้') {
        return new HttpError(403, 'FORBIDDEN', message, details);
    }

    /**
     * 404 Not Found
     */
    notFound(details = null, message = 'ไม่พบข้อมูล') {
        return new HttpError(404, 'NOT_FOUND', message, details);
    }

    /**
     * 409 Conflict
     */
    conflict(details = null, message = 'ข้อมูลซ้ำกับที่มีอยู่แล้ว') {
        return new HttpError(409, 'CONFLICT', message, details);
    }

    /**
     * 422 Unprocessable Entity (Validation Error)
     */
    validation(details = null, message = 'ข้อมูลไม่ถูกต้อง') {
        return new HttpError(422, 'VALIDATION_ERROR', message, details);
    }

    /**
     * 429 Rate Limit Exceeded
     */
    rateLimit(details = null, message = 'ขอใช้งานเกินจำนวนที่กำหนด') {
        return new HttpError(429, 'RATE_LIMIT_EXCEEDED', message, details);
    }

    /**
     * 500 Internal Server Error
     */
    internal(details = null, message = 'เกิดข้อผิดพลาดในระบบ') {
        return new HttpError(500, 'INTERNAL_SERVER_ERROR', message, details);
    }

    /**
     * 503 Service Unavailable
     */
    serviceUnavailable(details = null, message = 'บริการไม่พร้อมใช้งานชั่วคราว') {
        return new HttpError(503, 'SERVICE_UNAVAILABLE', message, details);
    }
}

// Export instance เดียวเพื่อใช้งานง่าย
export default new ErrorUtility();

// Export class ไว้กรณีต้องการตรวจสอบประเภท error (instanceof)
export { HttpError };
