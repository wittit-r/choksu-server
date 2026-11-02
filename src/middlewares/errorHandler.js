/**
 * Error Handler Middleware
 * จัดการ errors ทั้งหมดและส่ง response ในรูปแบบมาตรฐาน
 */

export const errorHandler = (err, req, res, next) => {
    let status = err.status;
    const errorResponse = {
        success: false,
        error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "เกิดข้อผิดพลาดในระบบ",
        }
    };

    if (status) {
        errorResponse.error.code = err.code;
        errorResponse.error.message = err.message;
        errorResponse.error.details = err.details;
    } else {
        status = 500;
    }

    if (process.env.NODE_ENV != "production") {
        errorResponse.error.stack = err.stack;
        console.error(err.stack);
        console.error(JSON.stringify(err, null, 2));
    }

    return res.status(status).json(errorResponse);
};

export default {
    errorHandler,
};
