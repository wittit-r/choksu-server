import crypto from 'crypto';
import { User, Session } from '../../src/database/index.js';
import { hashPassword } from '../../src/utils/password.js';

/**
 * สร้าง user + session ทดสอบลง MySQL test DB
 */
export async function createTestAuth() {
    const passwordHash = await hashPassword('test1234');

    const user = await User.create({
        username: 'test-accounting',
        firstName: 'Test',
        lastName: 'Accounting',
        passwordHash,
        role: 'ACCOUNTING',
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
