import { Sequelize } from "sequelize";
import { defineModels } from "./models.js";

/**
 * Sequelize instance กลางของระบบ (MySQL)
 *
 * กติกาเวลา (สำคัญ — อ่าน docs/PHASE-B-PLAN.md):
 * - timezone: '+07:00' → naive DATETIME เก็บ/อ่านเป็น "เวลาไทยตรงๆ"
 * - โค้ดใช้ getHours()/getDate() (local) ได้ตามปกติ, ห้ามใช้ getUTC*
 * - ควบคู่กับ TZ=Asia/Bangkok ที่ pin ไว้ใน npm scripts (สองชั้น)
 */
const globalForDb = globalThis;

function createDatabase() {
    const sequelize = new Sequelize(process.env.DATABASE_URL, {
        timezone: "+07:00",
        define: {
            underscored: true,
            freezeTableName: true,
        },
        pool: { max: 10, min: 0, idle: 10000 },
        logging: false,
    });

    const models = defineModels(sequelize);
    return { sequelize, ...models };
}

const db = globalForDb.choksuDb ?? createDatabase();

if (process.env.NODE_ENV !== "production") globalForDb.choksuDb = db;

export const sequelize = db.sequelize;
export const {
    Branch, Position, Contract, PayPeriod, User, Session, AuditLog,
    WorkLeader, Employee, WageRate, BillRate, TimeSheet, TimeEntry,
    Holiday, LeaveType, Leave, LeaveEntitlement,
    Payroll, PayrollRelate, InvoicePeriod, Invoice, InvoiceRelate,
} = db;
export default db;
