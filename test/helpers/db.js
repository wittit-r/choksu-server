import { sequelize } from '../../src/database/index.js';

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

/**
 * ล้างข้อมูลทั้งหมดใน MySQL test DB + reset auto increment
 */
export async function cleanDatabase() {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) {
        await sequelize.query(`DELETE FROM ${table}`);
    }
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    for (const table of TABLES) {
        await sequelize.query(`ALTER TABLE ${table} AUTO_INCREMENT = 1`);
    }
}

export async function disconnectPrisma() {
    // ชื่อเดิมสมัย Prisma — ตอนนี้ปิด connection Sequelize
    await sequelize.close();
}
