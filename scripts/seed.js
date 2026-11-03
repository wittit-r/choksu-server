/**
 * Seed ข้อมูลมาตรฐานของระบบ (MySQL + Sequelize)
 *
 * ใช้: node --env-file=.env scripts/seed.js                (เติมเฉพาะของที่ขาด — ปลอดภัยกับข้อมูลมีอยู่)
 *       node --env-file=.env scripts/seed.js --reset --yes (ล้างทุกตารางแล้ว seed ใหม่ — ต้องมี --yes เสมอ)
 *
 * ⚠️ --reset ลบข้อมูลทั้งหมด — ทดสอบ script นี้ให้ใช้ DB เปล่า อย่ารันบน DB ที่มีข้อมูลจริง
 *
 * ข้อมูลอ้างอิง (สาขา/ตำแหน่ง/หัวหน้างาน) มาจากชุดจริงของโปรเจค
 * พนักงานตัวอย่าง 2 คนเป็นข้อมูลทดสอบ (นำหน้า SEED-) ลบออกได้ไม่กระทบอะไร
 */
import { sequelize, Branch, Position, WorkLeader, User, Employee, WageRate, Holiday, LeaveType } from "../src/database/index.js";
import { hashPassword } from "../src/utils/password.js";

const RESET = process.argv.includes("--reset") && process.argv.includes("--yes");

const BRANCHES = [
    { name: "กฟจ.พบ", fullname: "การไฟฟ้าส่วนภูมิภาคเขต 1 (ภาคใต้) จังหวัดเพชรบุรี" },
    { name: "กฟส.บ้านแหลม", fullname: "การไฟฟ้าส่วนภูมิภาคเขต 1 (ภาคใต้) อำเภอบ้านแหลม" },
    { name: "กฟส.เขาย้อย", fullname: "การไฟฟ้าส่วนภูมิภาคเขต 1 (ภาคใต้) อำเภอเขาย้อย" },
];

const POSITIONS = [
    { name: "คนงานธรรมดา", code: "W01", employeeType: "WORKER" },
    { name: "คนงานฝีมือ", code: "W02", employeeType: "WORKER" },
    { name: "คนงานชำนาญพิเศษ", code: "W03", employeeType: "WORKER" },
    { name: "คนขับรถ ชนิด 1", code: "D01", employeeType: "DRIVER" },
    { name: "คนขับรถ ชนิด 2", code: "D02", employeeType: "DRIVER" },
    { name: "คนขับรถ ชนิด 2+(เครน < 16)", code: "D02+", employeeType: "DRIVER" },
    { name: "คนขับรถ ชนิด 2++(เครน > 16)", code: "D02++", employeeType: "DRIVER" },
    { name: "คนขับรถ ชนิด 3", code: "D03", employeeType: "DRIVER" },
    { name: "คนขับเรือ", code: "D04", employeeType: "DRIVER" },
];

const WORK_LEADERS = [
    { name: "อนวัชร ศรีแจ้", refNo: "I-67-J-JOB67.HB.1113", branchName: "กฟจ.พบ" },
    { name: "ชนินทร์ อิ่มสอาด", refNo: "P-TDD02.3-J-PRBD0.0008", branchName: "กฟจ.พบ" },
];

// พนักงานตัวอย่าง (SEED-) — ค่าแรงอิง W01
const SAMPLE_EMPLOYEES = [
    { firstName: "SEED-", lastName: "คนงาน01", idCard: "9000000000001", bankAccount: "9000000001", shiftType: "REGULAR", positionCode: "W01" },
    { firstName: "SEED-", lastName: "คนขับ01", idCard: "9000000000002", bankAccount: "9000000002", shiftType: "REGULAR", positionCode: "D01" },
];

const WAGE_BY_CODE = {
    W01: { dailyRate: 500, hourlyRate: 62.5, minuteRate: 1.042, monthlyRate: 0 },
    W02: { dailyRate: 550, hourlyRate: 68.75, minuteRate: 1.146, monthlyRate: 0 },
    W03: { dailyRate: 600, hourlyRate: 75, minuteRate: 1.25, monthlyRate: 0 },
    D01: { dailyRate: 650, hourlyRate: 81.25, minuteRate: 1.354, monthlyRate: 0 },
};

// ชนิดวันลา + สิทธิ์ default ต่อปี (แก้ไขได้ผ่านระบบ)
const LEAVE_TYPES = [
    { name: "ลาป่วย", defaultDaysPerYear: 30 },
    { name: "พักร้อน", defaultDaysPerYear: 7 },
    { name: "ลากิจ", defaultDaysPerYear: 3 },
];

// วันหยุดนักขัตฤกษ์ตัวอย่าง (วันตามราชการที่ตรงแน่) — แก้/เพิ่ม/ลบได้ผ่านระบบทุกปี
// หมายเหตุ: วันจันทรคติ (มาฆบูชา/วิสาขบูชา/เข้าพรรษา/อาสาฬหบูชา) + หยุดชดเชจพิเศษของ กฟภ. ต้องใส่เพิ่มเองรายปี
const HOLIDAYS = [
    // 2026
    { holidayDate: "2026-01-01", name: "วันปีใหม่" },
    { holidayDate: "2026-04-06", name: "วันจักรี" },
    { holidayDate: "2026-04-13", name: "วันสงกรานต์" },
    { holidayDate: "2026-04-14", name: "วันสงกรานต์" },
    { holidayDate: "2026-04-15", name: "วันสงกรานต์" },
    { holidayDate: "2026-05-01", name: "วันแรงงานแห่งชาติ" },
    { holidayDate: "2026-05-05", name: "วันฉัตรมงคล (ชดเชย)" },
    { holidayDate: "2026-08-12", name: "วันแม่แห่งชาติ" },
    { holidayDate: "2026-10-13", name: "วันนวมินทรมหาราช" },
    { holidayDate: "2026-12-05", name: "วันพ่อแห่งชาติ" },
    { holidayDate: "2026-12-07", name: "วันพ่อแห่งชาติ (ชดเชย)" },
    { holidayDate: "2026-12-10", name: "วันรัฐธรรมนูญ" },
    { holidayDate: "2026-12-31", name: "วันสิ้นปี" },
    // 2027
    { holidayDate: "2027-01-01", name: "วันปีใหม่" },
    { holidayDate: "2027-04-06", name: "วันจักรี" },
    { holidayDate: "2027-04-13", name: "วันสงกรานต์" },
    { holidayDate: "2027-04-14", name: "วันสงกรานต์" },
    { holidayDate: "2027-04-15", name: "วันสงกรานต์" },
    { holidayDate: "2027-05-03", name: "วันแรงงานแห่งชาติ (ชดเชย)" },
    { holidayDate: "2027-05-05", name: "วันฉัตรมงคล (ชดเชย)" },
    { holidayDate: "2027-08-12", name: "วันแม่แห่งชาติ" },
    { holidayDate: "2027-10-13", name: "วันนวมินทรมหาราช" },
    { holidayDate: "2027-12-06", name: "วันพ่อแห่งชาติ (ชดเชย)" },
    { holidayDate: "2027-12-10", name: "วันรัฐธรรมนูญ" },
    { holidayDate: "2027-12-31", name: "วันสิ้นปี" },
];

const run = async () => {
    await sequelize.authenticate();

    if (RESET) {
        console.log("ล้างข้อมูลทุกตาราง...");
        await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const t of ["audit_logs", "invoice_relates", "invoices", "invoice_periods", "bill_rates",
            "payroll_relates", "payrolls", "time_entries", "time_sheets", "wage_rates",
            "leave_entitlements", "leaves", "leave_types", "holidays",
            "employees", "sessions", "users", "work_leaders", "contracts", "positions", "branches"]) {
            await sequelize.query(`DELETE FROM ${t}`);
            await sequelize.query(`ALTER TABLE ${t} AUTO_INCREMENT = 1`);
        }
        await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    // admin (ข้ามถ้ามีชื่อนี้อยู่แล้ว)
    const [admin] = await User.findOrCreate({
        where: { username: "admin" },
        defaults: {
            firstName: "System",
            lastName: "Admin",
            username: "admin",
            passwordHash: await hashPassword("123456"),
            role: "SUPER_ADMIN",
            isActive: true,
        },
    });
    console.log("user admin: id", admin.id, admin.isNewRecord ? "(สร้างใหม่)" : "(มีอยู่แล้ว)");

    // branches / positions / work leaders
    for (const b of BRANCHES) await Branch.findOrCreate({ where: { name: b.name }, defaults: b });
    const [branchCount] = await Branch.count ? [await Branch.count()] : [0];
    console.log("branches:", branchCount);

    for (const p of POSITIONS) await Position.findOrCreate({ where: { code: p.code }, defaults: p });
    console.log("positions:", await Position.count());

    const phetchaburi = await Branch.findOne({ where: { name: "กฟจ.พบ" } });
    for (const w of WORK_LEADERS) {
        await WorkLeader.findOrCreate({
            where: { name: w.name },
            defaults: { name: w.name, refNo: w.refNo, branchId: phetchaburi.id, isActive: true },
        });
    }
    console.log("work_leaders:", await WorkLeader.count());

    // ชนิดวันลา + วันหยุดนักขัตฤกษ์
    for (const lt of LEAVE_TYPES) {
        await LeaveType.findOrCreate({ where: { name: lt.name }, defaults: { ...lt, isActive: true } });
    }
    console.log("leave_types:", await LeaveType.count());

    for (const h of HOLIDAYS) {
        // numeric-local constructor → เที่ยงคืนเวลาไทยตรงๆ ไม่ขึ้นกับ TZ env
        // (string "T00:00:00" ถูก parse เป็น UTC เมื่อไม่มี TZ=Asia/Bangkok → เก็บเพี้ยน 07:00)
        const [y, mo, d] = h.holidayDate.split("-").map(Number);
        const holidayDate = new Date(y, mo - 1, d);
        await Holiday.findOrCreate({
            where: { holidayDate },
            defaults: { holidayDate, name: h.name },
        });
    }
    console.log("holidays:", await Holiday.count());

    // พนักงานตัวอย่าง + ค่าแรง
    const wl = await WorkLeader.findOne();
    for (const e of SAMPLE_EMPLOYEES) {
        const [emp, created] = await Employee.findOrCreate({
            where: { idCard: e.idCard },
            defaults: {
                firstName: e.firstName, lastName: e.lastName, idCard: e.idCard,
                bankAccount: e.bankAccount, shiftType: e.shiftType,
                workLeaderId: wl.id, startDate: new Date("2026-01-01"), isActive: true,
            },
        });
        if (created) {
            const pos = await Position.findOne({ where: { code: e.positionCode } });
            await WageRate.create({
                employeeId: emp.id, positionId: pos.id,
                ...WAGE_BY_CODE[e.positionCode],
                effectiveFrom: new Date("2026-01-01"),
            });
            console.log("สร้างพนักงานตัวอย่าง:", e.lastName, `(${e.positionCode})`);
        }
    }

    console.log("\n✅ Seed เสร็จ (admin/123456)");
    await sequelize.close();
};

run().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
