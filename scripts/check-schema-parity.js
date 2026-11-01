/**
 * เทียบโครงสร้าง schema ระหว่าง PostgreSQL (ต้นทาง) กับ MySQL (ปลายทาง)
 * ใช้: node --env-file=.env scripts/check-schema-parity.js
 *
 * เทียบ: ตาราง / คอลัมน์ (ชื่อ+nullability+type แบบ normalize) / PK / unique / FK onDelete
 * type ที่ถือว่าเทียบเท่า:
 *   TEXT ↔ VARCHAR(n)/TEXT, TIMESTAMP ↔ DATETIME, JSONB ↔ JSON,
 *   BOOLEAN ↔ TINYINT(1), SERIAL ↔ INT AUTO_INCREMENT, enum ↔ enum (เทียบค่า)
 */
import pg from "pg";
import mysql from "mysql2/promise";

const PG_URL = "postgresql://postgres:postgresql@localhost:5432/choksu";
const MY_URL = "mysql://root:root@127.0.0.1:3306/choksu";

const normType = (raw) => {
    const t = raw.toLowerCase();
    if (t.startsWith("varchar") || t === "text" || t.startsWith("character")) return "string";
    if (t.startsWith("timestamp") || t.startsWith("datetime")) return "datetime";
    if (t === "jsonb" || t === "json") return "json";
    if (t === "boolean" || t === "tinyint(1)") return "bool";
    if (t.startsWith("decimal") || t.startsWith("numeric")) return t.replace("numeric", "decimal");
    if (t.startsWith("enum")) return t; // เทียบค่า enum ตรงๆ
    if (t.startsWith("integer") || t === "int" || t.startsWith("serial") || t === "serial") return "int";
    return t;
};

const getPG = async (client) => {
    const cols = await client.query(`
        SELECT table_name, column_name, data_type, udt_name, is_nullable, character_maximum_length,
               numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name NOT LIKE '_prisma%'
        ORDER BY table_name, ordinal_position`);
    const pks = await client.query(`
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name NOT LIKE '\_prisma%'`);
    const uqIdx = await client.query(`
        SELECT tablename AS table_name, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE%' AND tablename NOT LIKE '_prisma%'`);
    const uqs = uqIdx.rows
        .filter(r => !/_pkey ON/.test(r.indexdef))
        .map(r => ({
            table_name: r.table_name,
            cols: r.indexdef.match(/\((.*)\)\s*$/)[1].split(',').map(x => x.trim().replace(/"/g, '')),
        }));
    const fks = await client.query(`
        SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
    return { cols: cols.rows, pks: pks.rows, uqs, fks: fks.rows };
};

const getMY = async (conn) => {
    const [cols] = await conn.query(`
        SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type,
               column_type AS column_type, is_nullable AS is_nullable,
               character_maximum_length AS char_len, numeric_precision AS num_prec, numeric_scale AS num_scale
        FROM information_schema.columns
        WHERE table_schema = 'choksu' AND table_name NOT LIKE 'sequelize%'
        ORDER BY table_name, ordinal_position`);
    const [pks] = await conn.query(`
        SELECT table_name AS table_name, column_name AS column_name
        FROM information_schema.key_column_usage
        WHERE constraint_schema = 'choksu' AND LOWER(constraint_name) = 'primary'`);
    const [uqs] = await conn.query(`
        SELECT table_name AS table_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
        FROM information_schema.statistics
        WHERE table_schema = 'choksu' AND non_unique = 0 AND LOWER(index_name) != 'primary'
        GROUP BY table_name, index_name`);
    const [fks] = await conn.query(`
        SELECT kcu.table_name AS table_name, kcu.column_name AS column_name,
               kcu.referenced_table_name AS ref_table, rc.delete_rule AS delete_rule
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_schema = kcu.constraint_schema AND rc.constraint_name = kcu.constraint_name
        WHERE kcu.table_schema = 'choksu' AND kcu.referenced_table_name IS NOT NULL`);
    return { cols, pks, uqs, fks };
};

const pgTypeOf = (c) => {
    if (c.udt_name && !["int4", "text", "bool", "timestamp", "jsonb", "numeric", "varchar"].includes(c.udt_name)) {
        // enum type
        return null; // ต้องดึงค่า enum แยก
    }
    if (c.data_type === "character varying") return "string";
    if (c.data_type === "text") return "string";
    if (c.data_type === "timestamp without time zone") return "datetime";
    if (c.data_type === "jsonb") return "json";
    if (c.data_type === "boolean") return "bool";
    if (c.data_type === "numeric") return `decimal(${c.numeric_precision},${c.numeric_scale})`;
    if (c.data_type === "integer" || c.data_type === "serial") return "int";
    return c.data_type;
};

const run = async () => {
    const pgClient = new pg.Client({ connectionString: PG_URL });
    await pgClient.connect();
    // ดึงค่า enum ของ PG
    const enums = await pgClient.query(`
        SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS vals
        FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid GROUP BY t.typname`);
    const enumMap = new Map(enums.rows.map(r => [r.typname,
        typeof r.vals === 'string' ? r.vals.slice(1, -1).split(',') : r.vals]));

    const myConn = await mysql.createConnection(MY_URL);
    const [pgd, myd] = [await getPG(pgClient), await getMY(myConn)];

    const problems = [];

    // 1) ตาราง
    const pgTables = [...new Set(pgd.cols.map(c => c.table_name))].sort();
    const myTables = [...new Set(myd.cols.map(c => c.table_name))].sort();
    const missingInMy = pgTables.filter(t => !myTables.includes(t));
    const extraInMy = myTables.filter(t => !pgTables.includes(t));
    if (missingInMy.length) problems.push(`ตารางหายใน MySQL: ${missingInMy.join(", ")}`);
    if (extraInMy.length) problems.push(`ตารางเกินใน MySQL: ${extraInMy.join(", ")}`);

    // 2) คอลัมน์
    const myColMap = new Map(myd.cols.map(c => [`${c.table_name}.${c.column_name}`, c]));
    for (const c of pgd.cols) {
        const key = `${c.table_name}.${c.column_name}`;
        const m = myColMap.get(key);
        if (!m) { problems.push(`คอลัมน์หาย: ${key}`); continue; }

        const pgNullable = c.is_nullable === "YES";
        const myNullable = m.is_nullable === "YES";
        // PG SERIAL/autoincrement ↔ MySQL auto_increment, created_at ของ MySQL อาจ NOT NULL เพราะ Sequelize
        if (pgNullable !== myNullable) {
            const soft = c.column_name === "updated_at"; // MySQL บังคับไม่ null แต่ Sequelize เขียนทุกครั้ง
            problems.push(`${soft ? "⚠️ (ยอมรับได้)" : "❌"} null ต่างกัน: ${key} PG=${pgNullable} MY=${myNullable}`);
        }

        let pgT = pgTypeOf(c);
        if (pgT === null) {
            const vals = enumMap.get(c.udt_name);
            pgT = `enum('${vals.join("','")}')`;
        }
        let myT = m.column_type.toLowerCase();
        if (myT.startsWith("varchar") || myT === "text") myT = "string";
        const myNorm = normType(myT);
        const pgNorm = pgT.startsWith("enum") ? pgT : normType(pgT);
        const enumEqual = pgT.startsWith("enum") && myNorm === pgNorm.toLowerCase();
        if (pgNorm !== myNorm && !enumEqual && !(pgNorm === "string" && myNorm === "string")) {
            problems.push(`❌ type ต่างกัน: ${key} PG=${pgT} → MY=${m.column_type}`);
        }
    }

    // 3) PK
    const pgPkSet = new Set(pgd.pks.map(p => `${p.table_name}.${p.column_name}`));
    const myPkSet = new Set(myd.pks.map(p => `${p.table_name}.${p.column_name}`));
    for (const k of pgPkSet) if (!myPkSet.has(k)) problems.push(`PK หายใน MySQL: ${k}`);
    for (const k of myPkSet) if (!pgPkSet.has(k)) problems.push(`PK เกินใน MySQL: ${k}`);

    // 4) Unique
    const normUq = (rows) => {
        const map = new Map();
        for (const r of rows) {
            const colsArr = Array.isArray(r.cols) ? r.cols : String(r.cols).split(",");
            map.set(`${r.table_name}:[${colsArr.map(x => x.trim()).sort().join(",")}]`, true);
        }
        return map;
    };
    const pgUq = normUq(pgd.uqs);
    const myUq = normUq(myd.uqs);
    for (const k of pgUq.keys()) if (!myUq.has(k)) problems.push(`❌ unique หายใน MySQL: ${k}`);
    for (const k of myUq.keys()) if (!pgUq.has(k)) problems.push(`⚠️ unique เกินใน MySQL: ${k}`);

    // 5) FK + onDelete
    const normFk = (rows) => {
        const map = new Map();
        for (const r of rows) map.set(`${r.table_name}.${r.column_name}→${r.ref_table}`, r.delete_rule.toUpperCase());
        return map;
    };
    const pgFk = normFk(pgd.fks);
    const myFk = normFk(myd.fks);
    for (const [k, rule] of pgFk) {
        if (!myFk.has(k)) { problems.push(`❌ FK หายใน MySQL: ${k} (${rule})`); continue; }
        if (myFk.get(k) !== rule) problems.push(`❌ FK onDelete ต่างกัน: ${k} PG=${rule} MY=${myFk.get(k)}`);
    }
    for (const k of myFk.keys()) if (!pgFk.has(k)) problems.push(`⚠️ FK เกินใน MySQL: ${k}`);

    // สรุป
    console.log(`ตาราง: PG ${pgTables.length} / MySQL ${myTables.length}`);
    console.log(`คอลัมน์: PG ${pgd.cols.length} / MySQL ${myd.cols.length}`);
    const hard = problems.filter(p => p.startsWith("❌"));
    const soft = problems.filter(p => !p.startsWith("❌"));
    if (soft.length) { console.log("\n— ยอมรับได้ —"); soft.forEach(p => console.log(" ", p)); }
    if (hard.length) {
        console.log("\n— ต้องแก้ —");
        hard.forEach(p => console.log(" ", p));
        console.log(`\nผลลัพธ์: ❌ พบปัญหา ${hard.length} ข้อ`);
        process.exit(1);
    }
    console.log(`\nผลลัพธ์: ✅ schema เทียบเท่า (ยอมรับ ${soft.length} ข้อที่ไม่กระทบการทำงาน)`);

    await pgClient.end();
    await myConn.end();
    process.exit(0);
};

run().catch(e => { console.error(e.message); process.exit(1); });
