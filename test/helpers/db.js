import { sequelize } from '../../src/database/index.js';
import { testServer } from './client.js';

const TABLES = [
    'payroll_relates',
    'payrolls',
    'time_entries',
    'time_sheets',
    'wage_rates',
    'leaves',
    'leave_entitlements',
    'leave_types',
    'holidays',
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
    // ชื่อเดิมสมัย Prisma — ตอนนี้ปิดทั้ง Sequelize และ test server
    await sequelize.close();
    await new Promise((resolve) => testServer.close(resolve));
}
