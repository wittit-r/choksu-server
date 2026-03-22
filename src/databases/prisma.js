import { PrismaClient, Prisma } from '../../prisma/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis;

// Helper function แปลง Decimal เป็น Number (recursive)
function convertDecimals(obj) {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Prisma.Decimal) return Number(obj);
    if (Array.isArray(obj)) return obj.map(convertDecimals);
    if (typeof obj === 'object' && !(obj instanceof Date)) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = convertDecimals(value);
        }
        return result;
    }
    return obj;
}

function createPrismaClient() {
    const adapter = new PrismaPg({
        connectionString: process.env.DATABASE_URL,
    });

    const baseClient = new PrismaClient({ adapter });

    // Apply extension เพื่อแปลง Decimal เป็น Number สำหรับทุก model
    const extendedClient = baseClient.$extends({
        name: 'decimalToNumber',
        query: {
            $allModels: {
                // สำหรับทุก operation (findMany, findFirst, findUnique, create, update, etc.)
                async $allOperations({ args, query }) {
                    const result = await query(args);
                    return convertDecimals(result);
                }
            }
        }
    });

    return extendedClient;
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;