import crypto from 'crypto';
import prisma from '../../src/databases/prisma.js';
import { hashPassword } from '../../src/utils/password.js';

export async function createTestAuth() {
    const passwordHash = await hashPassword('test1234');

    const user = await prisma.user.create({
        data: {
            username: 'test-accounting',
            firstName: 'Test',
            lastName: 'Accounting',
            passwordHash,
            role: 'ACCOUNTING',
            isActive: true,
            isDeleted: false,
        },
    });

    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');

    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + 3600000);
    const refreshExpiresAt = new Date(now.getTime() + 7 * 86400000);

    await prisma.session.create({
        data: {
            userId: user.id,
            token: accessToken,
            refreshToken,
            accessExpiresAt,
            refreshExpiresAt,
        },
    });

    return { user, accessToken };
}
