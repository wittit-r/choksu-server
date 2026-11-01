/**
 * ย้ายข้อมูลจาก PostgreSQL (choksu) → MySQL (choksu)
 * ใช้: node scripts/migrate-from-pg.js
 *
 * กติกาแปลงเวลา (ดู docs/PHASE-B-PLAN.md):
 * - time_entries.start_time/end_time: +7 ชม. (wall−7 → เวลาไทย)
 * - time_sheets.work_date: ปรับเป็น 00:00 ของวันที่ (work_date + 7 ชม.)
 * - อื่นๆ copy ตรง (เป็นเวลาไทยอยู่แล้ว)
 * - อ่าน/เขียนเป็น string ดิบทั้งหมด (dateStrings) ไม่ผ่าน Date เด็ดขาด
 *   เพื่อกัน driver แปลง timezone แทรกซ้อน
 *
 * กรองขยะทดสอบ (สร้างตอนทดสอบ full loop 1 พ.ย. 2026):
 * - employees id 12, 13 (TESTONE/TESTTWO)
 * - pay_periods id 4, 5 (รอบ 9, 10 พ.ย.)
 * - time_sheets id 20-23 / time_entries ของ sheets เหล่านั้น
 * - payrolls id 11-14 + payroll_relates ของ payrolls เหล่านั้น
 * - wage_rates / sessions / audit_logs ที่ผูกกับของที่กรอง
 */
import pg from "pg";
import mysql from "mysql2/promise";

const PG_URL = "postgresql://postgres:postgresql@localhost:5432/choksu";
const MY_URL = "mysql://root:root@127.0.0.1:3306/choksu";

const EXCLUDE = {
    employees: [12, 13],
    pay_periods: [4, 5],
    time_sheets: [20, 21, 22, 23],
    payrolls: [11, 12, 13, 14, 15],
};

const addHours = (datetimeStr, hours) => {
    // '2026-11-18 01:00:00.123' + 7 → '2026-11-18 08:00:00.123' (คำนวณแบบ wall-clock ตรงๆ)
    const [datePart, timePart = "00:00:00"] = datetimeStr.split(" ");
    const [h, m, rest] = timePart.split(":");
    const [s, ms] = (rest || "00").split(".");
    let total = Number(h) * 3600 + Number(m) * 60 + Number(s) + hours * 3600;
    // ข้ามวัน
    let dayShift = Math.floor(total / 86400);
    total = ((total % 86400) + 86400) % 86400;
    const nh = String(Math.floor(total / 3600)).padStart(2, "0");
    const nm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const ns = String(total % 60).padStart(2, "0");
    if (dayShift !== 0) {
        const d = new Date(`${datePart}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dayShift);
        const nd = d.toISOString().slice(0, 10);
        return `${nd} ${nh}:${nm}:${ns}${ms ? "." + ms : ""}`;
    }
    return `${datePart} ${nh}:${nm}:${ns}${ms ? "." + ms : ""}`;
};

const run = async () => {
    // บังคับทุกชนิดวันที่เป็น string ดิบ (ไม่แปลงเป็น Date กัน timezone แทรกซ้อน)
    const dateOids = [1082, 1083, 1114, 1184];
    const pgc = new pg.Client({
        connectionString: PG_URL,
        types: {
            getTypeParser: (typeId, format) => {
                if (dateOids.includes(typeId)) return (v) => v;
                return pg.types.getTypeParser(typeId, format);
            },
        },
    });
    await pgc.connect();

    const my = await mysql.createConnection(MY_URL);

    const grab = async (sql, params = []) => (await pgc.query(sql, params)).rows;
    const notIn = (ids) => (ids.length ? `NOT IN (${ids.join(",")})` : "<> -1");

    // หาเวลา/entry ที่ต้องกรองตาม sheets ที่ตัดทิ้ง
    const excludedEntries = await grab(`SELECT id FROM time_entries WHERE time_sheet_id IN (${EXCLUDE.time_sheets.join(",")})`);
    EXCLUDE.time_entries = excludedEntries.map(r => r.id);
    const excludedRelates = await grab(`SELECT id FROM payroll_relates WHERE payroll_id IN (${EXCLUDE.payrolls.join(",")})`);
    EXCLUDE.payroll_relates = excludedRelates.map(r => r.id);
    const excludedWageRates = await grab(`SELECT id FROM wage_rates WHERE employee_id IN (${EXCLUDE.employees.join(",")})`);
    EXCLUDE.wage_rates = excludedWageRates.map(r => r.id);

    console.log("กรองขยะทดสอบ:", JSON.stringify(EXCLUDE));

    // ลำดับตาม FK
    const plan = [
        { table: "branches", order: "id" },
        { table: "positions", order: "id" },
        { table: "contracts", order: "id" },
        { table: "work_leaders", order: "id" },
        { table: "users", order: "id" },
        { table: "employees", order: "id", exclude: "employees" },
        { table: "wage_rates", order: "id", exclude: "wage_rates" },
        { table: "sessions", order: "id" },
        { table: "time_sheets", order: "id", exclude: "time_sheets" },
        {
            table: "time_entries", order: "id", exclude: "time_entries",
            transform: (row) => ({
                ...row,
                start_time: row.start_time ? addHours(row.start_time, 7) : row.start_time,
                end_time: row.end_time ? addHours(row.end_time, 7) : row.end_time,
            }),
        },
        { table: "pay_periods", order: "id", exclude: "pay_periods" },
        { table: "payrolls", order: "id", exclude: "payrolls" },
        { table: "payroll_relates", order: "id", exclude: "payroll_relates" },
        { table: "invoice_periods", order: "id" },
        { table: "invoices", order: "id" },
        { table: "invoice_relates", order: "id" },
        { table: "bill_rates", order: "id" },
        { table: "audit_logs", order: "id" },
    ];

    // เคลียร์ปลายทางก่อน (idempotent)
    await my.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["audit_logs", "invoice_relates", "invoices", "invoice_periods", "bill_rates",
        "payroll_relates", "payrolls", "pay_periods", "time_entries", "time_sheets",
        "sessions", "wage_rates", "employees", "users", "work_leaders", "contracts", "positions", "branches"]) {
        await my.query(`DELETE FROM ${t}`);
    }
    await my.query("SET FOREIGN_KEY_CHECKS = 1");

    const summary = [];
    for (const step of plan) {
        let where = "";
        if (step.exclude && EXCLUDE[step.exclude]?.length) {
            where = `WHERE id ${notIn(EXCLUDE[step.exclude])}`;
        }
        const rows = await grab(`SELECT * FROM ${step.table} ${where} ORDER BY ${step.order}`);
        const mapped = rows.map(step.transform || (r => r));
        for (const row of mapped) {
            // MySQL updated_at NOT NULL (Sequelize) — เติมด้วย created_at ถ้าของเดิมเป็น null
            if ("updated_at" in row && row.updated_at === null && row.created_at !== null) {
                row.updated_at = row.created_at;
            }
            const cols = Object.keys(row);
            const placeholders = cols.map(() => "?").join(",");
            await my.query(
                `INSERT INTO ${step.table} (${cols.join(",")}) VALUES (${placeholders})`,
                cols.map(c => row[c]),
            );
        }
        // ปรับ auto_increment ให้ต่อจาก max id
        if (mapped.length > 0) {
            const maxId = Math.max(...mapped.map(r => Number(r.id)));
            await my.query(`ALTER TABLE ${step.table} AUTO_INCREMENT = ${maxId + 1}`);
        }
        summary.push(`${step.table}: ${mapped.length} rows`);
    }

    console.log("\nย้ายเสร็จ:");
    summary.forEach(s => console.log(" ", s));

    // ─── Verify ───
    console.log("\nVerify (PG หลังหักกรอง vs MySQL):");
    let allOk = true;
    for (const step of plan) {
        const where = step.exclude && EXCLUDE[step.exclude]?.length
            ? `WHERE id ${notIn(EXCLUDE[step.exclude])}` : "";
        const pgCount = (await grab(`SELECT COUNT(*) AS n FROM ${step.table} ${where}`))[0].n;
        const [myCount] = await my.query(`SELECT COUNT(*) AS n FROM ${step.table}`);
        const ok = Number(pgCount) === Number(myCount[0].n);
        if (!ok) allOk = false;
        console.log(`  ${step.table}: PG=${pgCount} MY=${myCount[0].n} ${ok ? "✓" : "❌"}`);
    }

    // spot-check ยอดเงิน
    const spots = await grab(
        `SELECT pr.id, pr.pay_ref, te.id AS entry_id, te.paid_value
         FROM payrolls pr JOIN payroll_relates rel ON rel.payroll_id = pr.id
         JOIN time_entries te ON te.id = rel.time_entry_id
         WHERE pr.id NOT IN (${EXCLUDE.payrolls.join(",")}) ORDER BY pr.id LIMIT 5`);
    for (const sp of spots) {
        const [myRow] = await my.query(
            "SELECT paid_value, DATE_FORMAT(start_time, '%Y-%m-%d %H:%i') AS st FROM time_entries WHERE id = ?",
            [sp.entry_id]);
        const [myPay] = await my.query("SELECT pay_ref FROM payrolls WHERE id = ?", [sp.id]);
        console.log(`  spot payroll ${sp.pay_ref}/${myPay[0]?.pay_ref}: entry${sp.entry_id} paid PG=${sp.paid_value} MY=${myRow[0].paid_value} | start=${myRow[0].st}`);
        if (String(sp.paid_value) !== String(myRow[0].paid_value)) allOk = false;
    }

    console.log(`\nผลลัพธ์: ${allOk ? "✅ ย้ายข้อมูลสมบูรณ์" : "❌ มีความไม่ตรง — ตรวจก่อนใช้"}`);
    await pgc.end();
    await my.end();
    process.exit(allOk ? 0 : 1);
};

run().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
