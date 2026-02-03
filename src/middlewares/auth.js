import redis from "../databases/redis.js";
import prisma from "../databases/prisma.js";
import err from "../utils/error.js";

const REDIS_ACCESS_PREFIX = "auth:access:";
const REDIS_ACCESS_TTL = 3600; // 1 hour (seconds)

/**
 * Authentication Middleware
 * ตรวจสอบ access token พร้อม cache warming
 */
const auth = async (req, res, next) => {
    try {
        // 1. ดึง token จาก Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw err.unauthorized(null, "Authorization header ไม่ถูกต้อง");
        }

        const accessToken = authHeader.substring(7); // Remove "Bearer "

        // 2. Check Redis ก่อน (Fast path)
        const redisKeyPattern = `${REDIS_ACCESS_PREFIX}*:${accessToken}`;
        const keys = await redis().keys(redisKeyPattern);

        if (keys.length > 0) {
            // Token อยู่ใน Redis → ใช้งานได้
            const cachedData = await redis().get(keys[0]);
            req.user = JSON.parse(cachedData);
            req.accessToken = accessToken;
            return next();
        }

        // 3. Cache miss → Check Database (Slow path + Cache Warming)
        const session = await prisma.session.findUnique({
            where: { token: accessToken },
            include: { user: true }
        });

        if (!session) {
            // ไม่เจอใน DB → Invalid token
            throw err.unauthorized(null, "Token ไม่ถูกต้อง กรุณาล็อกอินใหม่");
        }

        // 4. ตรวจสอบ access token expiration
        const now = new Date();
        if (now > session.accessExpiresAt) {
            // Access token หมดอายุแล้ว → ต้องใช้ refresh token
            throw err.unauthorized(null, "Access token หมดอายุ กรุณาขอ access token ใหม่");
        }

        // 5. ตรวจสอบ refresh token expiration (session ยังอยู่หรือไม่)
        if (now > session.refreshExpiresAt) {
            // Session หมดอายุทั้งหมด → ลบและ reject
            await prisma.session.delete({ where: { id: session.id } });
            throw err.unauthorized(null, "Session หมดอายุ กรุณาล็อกอินใหม่");
        }

        // 6. ตรวจสอบ user status
        if (!session.user.isActive || session.user.isDeleted) {
            throw err.unauthorized(null, "บัญชีผู้ใช้ถูกระงับหรือถูกลบ");
        }

        // 7. Cache Warming - คำนวณ TTL ที่เหลืออยู่จริง
        const userData = {
            userId: session.user.id,
            username: session.user.username,
            role: session.user.role,
            employeeId: session.user.employeeId,
            sessionId: session.id
        };

        // คำนวณวินาทีที่เหลืออยู่จริงจนถึง accessExpiresAt
        const remainingMs = session.accessExpiresAt.getTime() - now.getTime();
        const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

        // ใช้ TTL ที่เหลืออยู่จริง (แต่ไม่เกิน REDIS_ACCESS_TTL)
        const ttl = Math.min(remainingSeconds, REDIS_ACCESS_TTL);

        const redisKey = `${REDIS_ACCESS_PREFIX}${session.user.id}:${accessToken}`;
        await redis().setex(redisKey, ttl, JSON.stringify(userData));

        // 8. Attach user info to request
        req.user = userData;
        req.accessToken = accessToken;

        next();
    } catch (error) {
        // ส่งต่อไปยัง error handler
        next(error);
    }
};

/**
 * Authorization Middleware - ตรวจสอบ role/permissions
 * @param {...String} allowedRoles - Roles ที่อนุญาต
 */
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return next(err.unauthorized(null, "ต้องล็อกอินก่อนใช้งาน"));
        }

        if (!allowedRoles.includes(req.user.role)) {
            return next(err.forbidden(null, "ไม่มีสิทธิ์เข้าถึง"));
        }

        next();
    };
};

export { auth, authorize };
