import ExcelJS from "exceljs";
import { Op } from "sequelize";

import { Payroll } from "../database/index.js";
import payPeriodService from "./pay-period.service.js";

const TYPE_LABELS = { WORKER: "คนงาน", DRIVER: "คนขับรถ" };
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Service รายงานนำส่งประกันสังคมรายเดือน (docs/SSO-PLAN.md)
 *
 * - รวมทุก payroll สถานะ PAID ของรอบที่ endDate ตกในเดือนที่ระบุ (WORKER 2 รอบ + DRIVER 1 รอบ)
 * - ฐานค่าจ้าง "คำนวณสด" จาก entries ผ่าน _buildPayrollSummary เหมือนหน้าสรุปยอด
 *   (แก้ time entry แล้วรายงานเปลี่ยนตามจริงเสมอ) / ยอดเรียกเก็บ = ssoAmount ที่เก็บจริง (รวม manual)
 * - ยอดสมทบนายจ้าง = ยอดเรียกเก็บลูกจ้าง (อัตราเดียวกัน)
 */
class SsoReportService {
    /**
     * รายงานรายเดือน (ใช้ทั้ง preview หน้าจอและ export xlsx — แหล่งข้อมูลเดียวกัน)
     * @param {Object} params
     * @param {number} params.month - 1-12
     * @param {number} params.year - ค.ศ.
     */
    async buildSsoReport({ month, year }) {
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 1);

        const payrolls = await Payroll.findAll({
            where: { status: "PAID" },
            include: [
                {
                    association: "employee",
                    attributes: ["id", "firstName", "lastName", "idCard"],
                },
                {
                    association: "payPeriod",
                    attributes: ["employeeType", "startDate", "endDate"],
                    where: { endDate: { [Op.gte]: monthStart, [Op.lt]: monthEnd } },
                    required: true,
                },
                {
                    association: "payrollRelates",
                    include: {
                        association: "timeEntry",
                        attributes: [
                            "id", "startTime", "endTime", "workType", "shiftType",
                            "otRate", "isNegative", "isRetro", "paidValue",
                        ],
                    },
                },
            ],
            order: [["id", "ASC"]],
        });

        const warnings = [];
        const employeeIds = [...new Set(payrolls.map((p) => p.employeeId))];
        const wageRateMap = await payPeriodService._getPrimaryWageRates(employeeIds, monthStart);

        const byEmployee = new Map();
        for (const payroll of payrolls) {
            const emp = payroll.employee;
            const period = payroll.payPeriod;

            // ฐานคำนวณสด — สูตรเดียวกับตอน auto-calc
            const summary = await payPeriodService._buildPayrollSummary(payroll, wageRateMap.get(emp.id) ?? { dailyRate: 0 }, {
                employeeType: period.employeeType,
                periodStartDate: period.startDate,
                periodEndDate: period.endDate,
            });
            const base = Math.max(0, Math.round((summary.regularAmount - summary.deductionAmount) * 100) / 100);

            if (payroll.ssoBase == null) {
                warnings.push(`SSO: ${emp.firstName} ${emp.lastName} — รายการจ่ายไม่มี snapshot ฐานค่าจ้าง (สร้างตอนยังไม่มีเงื่อนไขสปส.)`);
            }

            let row = byEmployee.get(emp.id);
            if (!row) {
                row = {
                    employeeType: period.employeeType,
                    idCard: emp.idCard,
                    name: `${emp.firstName} ${emp.lastName}`.trim(),
                    base: 0,
                    employeeAmount: 0,
                };
                byEmployee.set(emp.id, row);
            }
            row.base = Math.round((row.base + base) * 100) / 100;
            row.employeeAmount = Math.round((row.employeeAmount + (Number(payroll.ssoAmount) || 0)) * 100) / 100;
        }

        // เรียงตามประเภท แล้วชื่อ
        const rows = Array.from(byEmployee.values()).sort((a, b) =>
            a.employeeType === b.employeeType
                ? a.name.localeCompare(b.name, "th")
                : a.employeeType.localeCompare(b.employeeType),
        );

        const summary = {
            base: round2(rows.reduce((s, r) => s + r.base, 0)),
            employeeAmount: round2(rows.reduce((s, r) => s + r.employeeAmount, 0)),
        };
        summary.employerAmount = summary.employeeAmount;
        summary.total = round2(summary.employeeAmount * 2);

        return { month, year, rows, summary, warnings };
    }

    /**
     * สร้างไฟล์ xlsx รายงานนำส่ง — sheet เดียว + แถวรวมท้ายตาราง
     * เลขบัตรประชาชนเขียนเป็น text เสมอ (กันหาย 0 นำหน้า — pattern เดียวกับ export KBank)
     */
    async exportSsoReport({ month, year }) {
        const report = await this.buildSsoReport({ month, year });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("SSO");
        sheet.columns = [
            { header: "ประเภท", key: "employeeType", width: 12 },
            { header: "เลขบัตรประชาชน", key: "idCard", width: 18 },
            { header: "ชื่อ-นามสกุล", key: "name", width: 32 },
            { header: "ฐานค่าจ้าง", key: "base", width: 14 },
            { header: "ยอดเรียกเก็บลูกจ้าง", key: "employeeAmount", width: 18 },
            { header: "ยอดสมทบนายจ้าง", key: "employerAmount", width: 18 },
            { header: "รวมส่ง", key: "total", width: 14 },
        ];

        for (const row of report.rows) {
            sheet.addRow({
                employeeType: TYPE_LABELS[row.employeeType] ?? row.employeeType,
                idCard: String(row.idCard ?? ""),
                name: row.name,
                base: row.base,
                employeeAmount: row.employeeAmount,
                employerAmount: row.employeeAmount,
                total: round2(row.employeeAmount * 2),
            });
        }
        sheet.addRow({
            employeeType: "รวม",
            idCard: "",
            name: "",
            base: report.summary.base,
            employeeAmount: report.summary.employeeAmount,
            employerAmount: report.summary.employerAmount,
            total: report.summary.total,
        });
        sheet.lastRow.font = { bold: true };

        const buffer = await workbook.xlsx.writeBuffer();
        return {
            buffer,
            filename: `sso_report_${year}-${String(month).padStart(2, "0")}.xlsx`,
        };
    }
}

export default new SsoReportService();
