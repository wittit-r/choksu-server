import { Sequelize, DataTypes, Op, literal } from "sequelize";

/**
 * Sequelize models — schema เทียบเท่า prisma/migrations/20261031231810_init
 * กติกา:
 * - ชื่อ attribute เป็น camelCase เหมือน Prisma เดิม (services ไม่ต้องแก้ชื่อ)
 * - underscored: true → คอลัมน์ snake_case + created_at/updated_at
 * - ทุก field DECIMAL มี getter แปลงเป็น Number (แทน decimalToNumber extension)
 * - เวลา: naive = เวลาไทยตรงๆ (config timezone +07:00 ที่ index.js)
 */

const decimal = (precision, scale, options = {}) => ({
    type: DataTypes.DECIMAL(precision, scale),
    get() {
        const v = this.getDataValue(options.key);
        return v === null || v === undefined ? v : Number(v);
    },
    ...options.extra,
});

export const defineModels = (sequelize) => {
    // ─── พื้นฐาน (ไม่มี FK) ───────────────────────────────
    const Branch = sequelize.define("Branch", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.TEXT, allowNull: false },
        fullname: { type: DataTypes.TEXT },
    }, { tableName: "branches", underscored: true });

    const Position = sequelize.define("Position", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.TEXT, allowNull: false },
        code: { type: DataTypes.STRING(50), allowNull: false },
        employeeType: { type: DataTypes.ENUM("WORKER", "DRIVER"), allowNull: false },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, {
        tableName: "positions",
        underscored: true,
        indexes: [{ unique: true, fields: ["code"] }, { fields: ["employee_type"] }, { fields: ["is_active"] }],
    });

    const Contract = sequelize.define("Contract", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        contractNo: { type: DataTypes.STRING(50), allowNull: false },
        location: { type: DataTypes.TEXT },
        contractType: { type: DataTypes.ENUM("WORKER", "DRIVER"), allowNull: false },
        startDate: { type: DataTypes.DATE, allowNull: false },
        endDate: { type: DataTypes.DATE, allowNull: false },
    }, {
        tableName: "contracts",
        underscored: true,
        indexes: [{ unique: true, fields: ["contract_no"] }],
    });

    const PayPeriod = sequelize.define("PayPeriod", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        periodNo: { type: DataTypes.INTEGER, allowNull: false },
        year: { type: DataTypes.INTEGER, allowNull: false },
        employeeType: { type: DataTypes.ENUM("WORKER", "DRIVER"), allowNull: false },
        startDate: { type: DataTypes.DATE, allowNull: false },
        endDate: { type: DataTypes.DATE, allowNull: false },
        status: { type: DataTypes.ENUM("OPEN", "CLOSED"), allowNull: false, defaultValue: "OPEN" },
    }, {
        tableName: "pay_periods",
        underscored: true,
        indexes: [
            { unique: true, name: "uq_pay_periods_period", fields: ["year", "period_no", "employee_type"] },
            { fields: ["year"] }, { fields: ["employee_type"] }, { fields: ["status"] },
        ],
    });

    // ─── Users / Sessions / Audit ────────────────────────
    const User = sequelize.define("User", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        firstName: { type: DataTypes.TEXT, allowNull: false },
        lastName: { type: DataTypes.TEXT, allowNull: false },
        phone: { type: DataTypes.TEXT },
        username: { type: DataTypes.STRING(50), allowNull: false },
        passwordHash: { type: DataTypes.TEXT, allowNull: false },
        role: {
            type: DataTypes.ENUM("SUPER_ADMIN", "SENOIR_ACCOUNTING", "ACCOUNTING", "COORDINATOR"),
            allowNull: false,
            defaultValue: "ACCOUNTING",
        },
        branchId: { type: DataTypes.INTEGER },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        lastLoginAt: { type: DataTypes.DATE },
    }, {
        tableName: "users",
        underscored: true,
        defaultScope: {
            attributes: { exclude: ["passwordHash"] },
        },
        indexes: [{ unique: true, fields: ["username"] }],
    });

    const Session = sequelize.define("Session", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        token: { type: DataTypes.STRING(128), allowNull: false },
        refreshToken: { type: DataTypes.STRING(128), allowNull: false },
        accessExpiresAt: { type: DataTypes.DATE, allowNull: false },
        refreshExpiresAt: { type: DataTypes.DATE, allowNull: false },
    }, {
        tableName: "sessions",
        underscored: true,
        indexes: [
            { unique: true, fields: ["token"] },
            { unique: true, fields: ["refresh_token"] },
        ],
    });

    const AuditLog = sequelize.define("AuditLog", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        tableName: { type: DataTypes.STRING(100), allowNull: false, field: "table_name" },
        recordId: { type: DataTypes.INTEGER, allowNull: false },
        action: { type: DataTypes.TEXT, allowNull: false },
        oldValues: { type: DataTypes.JSON },
        newValues: { type: DataTypes.JSON },
        changedBy: { type: DataTypes.INTEGER, allowNull: false },
        changedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal("CURRENT_TIMESTAMP") },
    }, { tableName: "audit_logs", underscored: true, timestamps: false });

    // ─── องค์กร / พนักงาน / ค่าจ้าง ──────────────────────
    const WorkLeader = sequelize.define("WorkLeader", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.TEXT, allowNull: false },
        refNo: { type: DataTypes.TEXT },
        branchId: { type: DataTypes.INTEGER, allowNull: false },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, { tableName: "work_leaders", underscored: true });

    const Employee = sequelize.define("Employee", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        firstName: { type: DataTypes.TEXT, allowNull: false },
        lastName: { type: DataTypes.TEXT, allowNull: false },
        idCard: { type: DataTypes.STRING(20), allowNull: false },
        phone: { type: DataTypes.TEXT },
        bankAccount: { type: DataTypes.TEXT },
        shiftType: { type: DataTypes.ENUM("REGULAR", "SHIFT"), allowNull: false },
        workLeaderId: { type: DataTypes.INTEGER },
        startDate: { type: DataTypes.DATE, allowNull: false },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, {
        tableName: "employees",
        underscored: true,
        indexes: [{ unique: true, fields: ["id_card"] }],
    });

    const WageRate = sequelize.define("WageRate", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        employeeId: { type: DataTypes.INTEGER, allowNull: false },
        positionId: { type: DataTypes.INTEGER, allowNull: false },
        dailyRate: decimal(12, 3, { key: "dailyRate", extra: { allowNull: false } }),
        hourlyRate: decimal(12, 3, { key: "hourlyRate", extra: { allowNull: false } }),
        minuteRate: decimal(12, 3, { key: "minuteRate", extra: { allowNull: false } }),
        monthlyRate: decimal(12, 3, { key: "monthlyRate", extra: { allowNull: false } }),
        effectiveFrom: { type: DataTypes.DATE, allowNull: false },
        effectiveTo: { type: DataTypes.DATE },
        note: { type: DataTypes.TEXT },
    }, {
        tableName: "wage_rates",
        underscored: true,
        indexes: [{ fields: ["employee_id", "effective_from"] }, { fields: ["effective_from"] }],
    });

    const BillRate = sequelize.define("BillRate", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        contractId: { type: DataTypes.INTEGER, allowNull: false },
        positionId: { type: DataTypes.INTEGER, allowNull: false },
        dailyRate: decimal(12, 3, { key: "dailyRate", extra: { allowNull: false } }),
        hourlyRate: decimal(12, 3, { key: "hourlyRate", extra: { allowNull: false } }),
        minuteRate: decimal(12, 3, { key: "minuteRate", extra: { allowNull: false } }),
        monthlyRate: decimal(12, 3, { key: "monthlyRate", extra: { allowNull: false } }),
    }, {
        tableName: "bill_rates",
        underscored: true,
        indexes: [{ unique: true, fields: ["contract_id", "position_id"] }],
    });

    // ─── ลงเวลา ──────────────────────────────────────────
    const TimeSheet = sequelize.define("TimeSheet", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        workLeaderId: { type: DataTypes.INTEGER },
        workDate: { type: DataTypes.DATE },
        employeeId: { type: DataTypes.INTEGER },
        monthPeriod: { type: DataTypes.STRING(10) },
        sheetType: { type: DataTypes.ENUM("DAILY", "MONTHLY"), allowNull: false, defaultValue: "DAILY" },
        status: { type: DataTypes.ENUM("PENDING", "FILLED"), allowNull: false, defaultValue: "PENDING" },
        createBy: { type: DataTypes.INTEGER, allowNull: false },
        files: { type: DataTypes.JSON },
    }, {
        tableName: "time_sheets",
        underscored: true,
        indexes: [{ fields: ["work_date"] }, { fields: ["month_period"] }, { fields: ["status"] }],
    });

    const TimeEntry = sequelize.define("TimeEntry", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        timeSheetId: { type: DataTypes.INTEGER, allowNull: false },
        employeeId: { type: DataTypes.INTEGER, allowNull: false },
        startTime: { type: DataTypes.DATE, allowNull: false },
        endTime: { type: DataTypes.DATE },
        shiftType: { type: DataTypes.ENUM("REGULAR", "SHIFT"), allowNull: false },
        workType: { type: DataTypes.ENUM("REGULAR", "OVERTIME", "ACCOMMODATION"), allowNull: false },
        otRate: decimal(3, 1, { key: "otRate", extra: { allowNull: false, defaultValue: 0 } }),
        accommodation: decimal(12, 2, { key: "accommodation", extra: { allowNull: false, defaultValue: 0 } }),
        isNegative: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        isRetro: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        status: { type: DataTypes.ENUM("DRAFT", "LOCKED"), allowNull: false, defaultValue: "DRAFT" },
        referenceEntryId: { type: DataTypes.INTEGER },
        createBy: { type: DataTypes.INTEGER },
        paidValue: decimal(12, 2, { key: "paidValue" }),
        paidDate: { type: DataTypes.DATE },
        billDate: { type: DataTypes.DATE },
        note: { type: DataTypes.TEXT },
    }, {
        tableName: "time_entries",
        underscored: true,
        indexes: [
            { fields: ["time_sheet_id"] }, { fields: ["employee_id"] },
            { fields: ["reference_entry_id"] },
        ],
    });

    // ─── Payroll ─────────────────────────────────────────
    const Payroll = sequelize.define("Payroll", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        payRef: { type: DataTypes.STRING(50), allowNull: false },
        employeeId: { type: DataTypes.INTEGER, allowNull: false },
        payPeriodId: { type: DataTypes.INTEGER, allowNull: false },
        ssoAmount: decimal(12, 2, { key: "ssoAmount", extra: { allowNull: false, defaultValue: 0 } }),
        slfAmount: decimal(12, 2, { key: "slfAmount", extra: { allowNull: false, defaultValue: 0 } }),
        otherDeduction: decimal(12, 2, { key: "otherDeduction", extra: { allowNull: false, defaultValue: 0 } }),
        status: {
            type: DataTypes.ENUM("PENDING", "CALCULATED", "PAID", "CANCELLED"),
            allowNull: false,
            defaultValue: "PENDING",
        },
        paidDate: { type: DataTypes.DATE },
    }, {
        tableName: "payrolls",
        underscored: true,
        indexes: [{ unique: true, fields: ["pay_ref"] }, { fields: ["status"] }, { fields: ["paid_date"] }],
    });

    const PayrollRelate = sequelize.define("PayrollRelate", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        payrollId: { type: DataTypes.INTEGER, allowNull: false },
        timeEntryId: { type: DataTypes.INTEGER, allowNull: false },
    }, {
        tableName: "payroll_relates",
        underscored: true,
        updatedAt: false,
        indexes: [{ unique: true, fields: ["payroll_id", "time_entry_id"] }],
    });

    // ─── Invoice ─────────────────────────────────────────
    const InvoicePeriod = sequelize.define("InvoicePeriod", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        periodNo: { type: DataTypes.INTEGER, allowNull: false },
        year: { type: DataTypes.INTEGER, allowNull: false },
        employeeType: { type: DataTypes.ENUM("WORKER", "DRIVER"), allowNull: false },
        branchId: { type: DataTypes.INTEGER, allowNull: false },
        contractId: { type: DataTypes.INTEGER, allowNull: false },
        startDate: { type: DataTypes.DATE, allowNull: false },
        endDate: { type: DataTypes.DATE, allowNull: false },
        status: { type: DataTypes.ENUM("DRAFT", "RECEIVED", "CANCELLED"), allowNull: false, defaultValue: "DRAFT" },
        receivedDate: { type: DataTypes.DATE },
    }, {
        tableName: "invoice_periods",
        underscored: true,
        indexes: [
            { unique: true, name: "uq_invoice_periods_period", fields: ["year", "period_no", "employee_type", "branch_id", "contract_id"] },
            { fields: ["year"] }, { fields: ["status"] },
        ],
    });

    const Invoice = sequelize.define("Invoice", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        invoiceRef: { type: DataTypes.STRING(50), allowNull: false },
        invoicePeriodId: { type: DataTypes.INTEGER, allowNull: false },
        workLeaderId: { type: DataTypes.INTEGER },
        employeeId: { type: DataTypes.INTEGER },
        totalBillValue: decimal(12, 2, { key: "totalBillValue", extra: { allowNull: false, defaultValue: 0 } }),
        note: { type: DataTypes.TEXT },
    }, {
        tableName: "invoices",
        underscored: true,
        indexes: [{ unique: true, fields: ["invoice_ref"] }],
    });

    const InvoiceRelate = sequelize.define("InvoiceRelate", {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        invoiceId: { type: DataTypes.INTEGER, allowNull: false },
        timeEntryId: { type: DataTypes.INTEGER, allowNull: false },
    }, {
        tableName: "invoice_relates",
        underscored: true,
        updatedAt: false,
        indexes: [{ unique: true, fields: ["time_entry_id"] }],
    });

    // ─── Associations (onDelete ตรง baseline เป๊ะ) ───────
    // audit_logs
    AuditLog.belongsTo(User, { as: "changedByUser", foreignKey: "changedBy", onDelete: "RESTRICT" });
    User.hasMany(AuditLog, { as: "auditLogs", foreignKey: "changedBy", onDelete: "RESTRICT" });

    // branches
    Branch.hasMany(WorkLeader, { as: "workLeaders", foreignKey: "branchId", onDelete: "RESTRICT" });
    WorkLeader.belongsTo(Branch, { as: "branch", foreignKey: "branchId", onDelete: "RESTRICT" });
    Branch.hasMany(User, { as: "users", foreignKey: "branchId", onDelete: "SET NULL" });
    User.belongsTo(Branch, { as: "branch", foreignKey: "branchId", onDelete: "SET NULL" });
    Branch.hasMany(InvoicePeriod, { as: "invoicePeriods", foreignKey: "branchId", onDelete: "RESTRICT" });
    InvoicePeriod.belongsTo(Branch, { as: "branch", foreignKey: "branchId", onDelete: "RESTRICT" });

    // work_leaders
    WorkLeader.hasMany(Employee, { as: "employees", foreignKey: "workLeaderId", onDelete: "SET NULL" });
    Employee.belongsTo(WorkLeader, { as: "workLeader", foreignKey: "workLeaderId", onDelete: "SET NULL" });
    WorkLeader.hasMany(TimeSheet, { as: "timeSheets", foreignKey: "workLeaderId", onDelete: "SET NULL" });
    TimeSheet.belongsTo(WorkLeader, { as: "workLeader", foreignKey: "workLeaderId", onDelete: "SET NULL" });
    WorkLeader.hasMany(Invoice, { as: "invoices", foreignKey: "workLeaderId", onDelete: "SET NULL" });
    Invoice.belongsTo(WorkLeader, { as: "workLeader", foreignKey: "workLeaderId", onDelete: "SET NULL" });

    // employees
    Employee.hasMany(WageRate, { as: "wageRates", foreignKey: "employeeId", onDelete: "CASCADE" });
    WageRate.belongsTo(Employee, { as: "employee", foreignKey: "employeeId", onDelete: "CASCADE" });
    Employee.hasMany(TimeEntry, { as: "timeEntries", foreignKey: "employeeId", onDelete: "RESTRICT" });
    TimeEntry.belongsTo(Employee, { as: "employee", foreignKey: "employeeId", onDelete: "RESTRICT" });
    Employee.hasMany(TimeSheet, { as: "timeSheets", foreignKey: "employeeId", onDelete: "SET NULL" });
    TimeSheet.belongsTo(Employee, { as: "employee", foreignKey: "employeeId", onDelete: "SET NULL" });
    Employee.hasMany(Payroll, { as: "payrolls", foreignKey: "employeeId", onDelete: "RESTRICT" });
    Payroll.belongsTo(Employee, { as: "employee", foreignKey: "employeeId", onDelete: "RESTRICT" });
    Employee.hasMany(Invoice, { as: "invoices", foreignKey: "employeeId", onDelete: "SET NULL" });
    Invoice.belongsTo(Employee, { as: "employee", foreignKey: "employeeId", onDelete: "SET NULL" });

    // positions
    Position.hasMany(WageRate, { as: "wageRates", foreignKey: "positionId", onDelete: "RESTRICT" });
    WageRate.belongsTo(Position, { as: "position", foreignKey: "positionId", onDelete: "RESTRICT" });
    Position.hasMany(BillRate, { as: "billRates", foreignKey: "positionId", onDelete: "RESTRICT" });
    BillRate.belongsTo(Position, { as: "position", foreignKey: "positionId", onDelete: "RESTRICT" });

    // contracts
    Contract.hasMany(InvoicePeriod, { as: "invoicePeriods", foreignKey: "contractId", onDelete: "RESTRICT" });
    InvoicePeriod.belongsTo(Contract, { as: "contract", foreignKey: "contractId", onDelete: "RESTRICT" });
    Contract.hasMany(BillRate, { as: "billRates", foreignKey: "contractId", onDelete: "RESTRICT" });
    BillRate.belongsTo(Contract, { as: "contract", foreignKey: "contractId", onDelete: "RESTRICT" });

    // time_sheets / time_entries
    TimeSheet.hasMany(TimeEntry, { as: "timeEntries", foreignKey: "timeSheetId", onDelete: "CASCADE" });
    TimeEntry.belongsTo(TimeSheet, { as: "timeSheet", foreignKey: "timeSheetId", onDelete: "CASCADE" });
    User.hasMany(TimeSheet, { as: "createdTimeSheets", foreignKey: "createBy", onDelete: "RESTRICT" });
    TimeSheet.belongsTo(User, { as: "createByUser", foreignKey: "createBy", onDelete: "RESTRICT" });

    // pay_periods / payrolls
    PayPeriod.hasMany(Payroll, { as: "payrolls", foreignKey: "payPeriodId", onDelete: "RESTRICT" });
    Payroll.belongsTo(PayPeriod, { as: "payPeriod", foreignKey: "payPeriodId", onDelete: "RESTRICT" });
    Payroll.hasMany(PayrollRelate, { as: "payrollRelates", foreignKey: "payrollId", onDelete: "CASCADE" });
    PayrollRelate.belongsTo(Payroll, { as: "payroll", foreignKey: "payrollId", onDelete: "CASCADE" });
    PayrollRelate.belongsTo(TimeEntry, { as: "timeEntry", foreignKey: "timeEntryId", onDelete: "RESTRICT" });
    TimeEntry.hasMany(PayrollRelate, { as: "payrollRelates", foreignKey: "timeEntryId", onDelete: "RESTRICT" });

    // sessions
    User.hasMany(Session, { as: "sessions", foreignKey: "userId", onDelete: "CASCADE" });
    Session.belongsTo(User, { as: "user", foreignKey: "userId", onDelete: "CASCADE" });

    // invoices
    InvoicePeriod.hasMany(Invoice, { as: "invoices", foreignKey: "invoicePeriodId", onDelete: "RESTRICT" });
    Invoice.belongsTo(InvoicePeriod, { as: "invoicePeriod", foreignKey: "invoicePeriodId", onDelete: "RESTRICT" });
    Invoice.hasMany(InvoiceRelate, { as: "invoiceRelates", foreignKey: "invoiceId", onDelete: "CASCADE" });
    InvoiceRelate.belongsTo(Invoice, { as: "invoice", foreignKey: "invoiceId", onDelete: "CASCADE" });
    InvoiceRelate.belongsTo(TimeEntry, { as: "timeEntry", foreignKey: "timeEntryId", onDelete: "RESTRICT" });
    TimeEntry.hasMany(InvoiceRelate, { as: "invoiceRelates", foreignKey: "timeEntryId", onDelete: "RESTRICT" });

    return {
        Branch, Position, Contract, PayPeriod, User, Session, AuditLog,
        WorkLeader, Employee, WageRate, BillRate, TimeSheet, TimeEntry,
        Payroll, PayrollRelate, InvoicePeriod, Invoice, InvoiceRelate,
    };
};
