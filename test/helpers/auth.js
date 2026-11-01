import crypto from 'crypto';
import { User, Session } from '../../src/database/index.js';
import { hashPassword } from '../../src/utils/password.js';

/**
 * สร้าง user + session ทดสอบลง MySQL test DB
 * @param {string} role - default 'ACCOUNTING' (ใช้ 'SUPER_ADMIN' เมื่อ test authorize gates)
 */
export async function createTestAuth(role = 'ACCOUNTING') {
    const passwordHash = await hashPassword('test1234');

    const user = await User.create({
        username: `test-${role.toLowerCase()}-${Date.now()}`,
        firstName: 'Test',
        lastName: role.charAt(0) + role.slice(1).toLowerCase(),
        passwordHash,
        role,
        isActive: true,
        isDeleted: false,
    });

    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');

    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + 3600000);
    const refreshExpiresAt = new Date(now.getTime() + 7 * 86400000);

    await Session.create({
        userId: user.id,
        token: accessToken,
        refreshToken,
        accessExpiresAt,
        refreshExpiresAt,
    });

    return { user, accessToken };
}
