import prisma from '../../src/databases/prisma.js';

const TABLES = [
    'payroll_relates',
    'payrolls',
    'time_entries',
    'time_sheets',
    'wage_rates',
    'employees',
    'sessions',
    'users',
    'work_leaders',
    'branches',
    'positions',
    'contracts',
    'audit_logs',
    'pay_periods',
    'invoice_relates',
    'invoices',
    'invoice_periods',
    'bill_rates',
];

export async function cleanDatabase() {
    for (const table of TABLES) {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}" CASCADE`);
    }
}

export async function disconnectPrisma() {
    await prisma.$disconnect();
}
