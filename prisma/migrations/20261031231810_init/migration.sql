-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('WORKER', 'DRIVER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('PENDING', 'CALCULATED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('WORKER', 'DRIVER');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('REGULAR', 'SHIFT');

-- CreateEnum
CREATE TYPE "TimeSheetStatus" AS ENUM ('PENDING', 'FILLED');

-- CreateEnum
CREATE TYPE "TimeSheetType" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "WorkType" AS ENUM ('REGULAR', 'OVERTIME', 'ACCOMMODATION');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'LOCKED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SENOIR_ACCOUNTING', 'ACCOUNTING', 'COORDINATOR');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_by" INTEGER NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "fullname" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "contract_no" TEXT NOT NULL,
    "location" TEXT,
    "contract_type" "ContractType" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "id_card" TEXT NOT NULL,
    "phone" TEXT,
    "bank_account" TEXT,
    "shift_type" "ShiftType" NOT NULL,
    "work_leader_id" INTEGER,
    "start_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_periods" (
    "id" SERIAL NOT NULL,
    "period_no" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "employee_type" "EmployeeType" NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "received_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "invoice_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "invoice_ref" TEXT NOT NULL,
    "invoice_period_id" INTEGER NOT NULL,
    "work_leader_id" INTEGER,
    "employee_id" INTEGER,
    "total_bill_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_relates" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "time_entry_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_relates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_periods" (
    "id" SERIAL NOT NULL,
    "period_no" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "employee_type" "EmployeeType" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "pay_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" SERIAL NOT NULL,
    "pay_ref" TEXT NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "pay_period_id" INTEGER NOT NULL,
    "sso_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "slf_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "PayrollStatus" NOT NULL DEFAULT 'PENDING',
    "paid_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_relates" (
    "id" SERIAL NOT NULL,
    "payroll_id" INTEGER NOT NULL,
    "time_entry_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_relates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "employee_type" "EmployeeType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wage_rates" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "position_id" INTEGER NOT NULL,
    "daily_rate" DECIMAL(12,3) NOT NULL,
    "hourly_rate" DECIMAL(12,3) NOT NULL,
    "minute_rate" DECIMAL(12,3) NOT NULL,
    "monthly_rate" DECIMAL(12,3) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "wage_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_rates" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "position_id" INTEGER NOT NULL,
    "daily_rate" DECIMAL(12,3) NOT NULL,
    "hourly_rate" DECIMAL(12,3) NOT NULL,
    "minute_rate" DECIMAL(12,3) NOT NULL,
    "monthly_rate" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "bill_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_sheets" (
    "id" SERIAL NOT NULL,
    "work_leader_id" INTEGER,
    "work_date" TIMESTAMP(3),
    "employee_id" INTEGER,
    "month_period" TEXT,
    "sheet_type" "TimeSheetType" NOT NULL DEFAULT 'DAILY',
    "status" "TimeSheetStatus" NOT NULL DEFAULT 'PENDING',
    "create_by" INTEGER NOT NULL,
    "files" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "time_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" SERIAL NOT NULL,
    "time_sheet_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "shift_type" "ShiftType" NOT NULL,
    "work_type" "WorkType" NOT NULL,
    "ot_rate" DECIMAL(3,1) NOT NULL DEFAULT 0,
    "accommodation" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_negative" BOOLEAN NOT NULL DEFAULT false,
    "is_retro" BOOLEAN NOT NULL DEFAULT false,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "reference_entry_id" INTEGER,
    "create_by" INTEGER,
    "paid_value" DECIMAL(12,2),
    "paid_date" TIMESTAMP(3),
    "bill_date" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ACCOUNTING',
    "branch_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "access_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_leaders" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "ref_no" TEXT,
    "branch_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "work_leaders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_table_name_idx" ON "audit_logs"("table_name");

-- CreateIndex
CREATE INDEX "audit_logs_record_id_idx" ON "audit_logs"("record_id");

-- CreateIndex
CREATE INDEX "audit_logs_changed_by_idx" ON "audit_logs"("changed_by");

-- CreateIndex
CREATE INDEX "audit_logs_changed_at_idx" ON "audit_logs"("changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_no_key" ON "contracts"("contract_no");

-- CreateIndex
CREATE INDEX "contracts_contract_type_idx" ON "contracts"("contract_type");

-- CreateIndex
CREATE INDEX "contracts_start_date_idx" ON "contracts"("start_date");

-- CreateIndex
CREATE INDEX "contracts_end_date_idx" ON "contracts"("end_date");

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_card_key" ON "employees"("id_card");

-- CreateIndex
CREATE INDEX "employees_work_leader_id_idx" ON "employees"("work_leader_id");

-- CreateIndex
CREATE INDEX "employees_is_active_idx" ON "employees"("is_active");

-- CreateIndex
CREATE INDEX "invoice_periods_year_idx" ON "invoice_periods"("year");

-- CreateIndex
CREATE INDEX "invoice_periods_branch_id_idx" ON "invoice_periods"("branch_id");

-- CreateIndex
CREATE INDEX "invoice_periods_contract_id_idx" ON "invoice_periods"("contract_id");

-- CreateIndex
CREATE INDEX "invoice_periods_employee_type_idx" ON "invoice_periods"("employee_type");

-- CreateIndex
CREATE INDEX "invoice_periods_status_idx" ON "invoice_periods"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_periods_year_period_no_employee_type_branch_id_cont_key" ON "invoice_periods"("year", "period_no", "employee_type", "branch_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_ref_key" ON "invoices"("invoice_ref");

-- CreateIndex
CREATE INDEX "invoices_invoice_period_id_idx" ON "invoices"("invoice_period_id");

-- CreateIndex
CREATE INDEX "invoices_work_leader_id_idx" ON "invoices"("work_leader_id");

-- CreateIndex
CREATE INDEX "invoices_employee_id_idx" ON "invoices"("employee_id");

-- CreateIndex
CREATE INDEX "invoice_relates_invoice_id_idx" ON "invoice_relates"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_relates_time_entry_id_idx" ON "invoice_relates"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_relates_time_entry_id_key" ON "invoice_relates"("time_entry_id");

-- CreateIndex
CREATE INDEX "pay_periods_year_idx" ON "pay_periods"("year");

-- CreateIndex
CREATE INDEX "pay_periods_employee_type_idx" ON "pay_periods"("employee_type");

-- CreateIndex
CREATE INDEX "pay_periods_status_idx" ON "pay_periods"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pay_periods_year_period_no_employee_type_key" ON "pay_periods"("year", "period_no", "employee_type");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_pay_ref_key" ON "payrolls"("pay_ref");

-- CreateIndex
CREATE INDEX "payrolls_employee_id_idx" ON "payrolls"("employee_id");

-- CreateIndex
CREATE INDEX "payrolls_pay_period_id_idx" ON "payrolls"("pay_period_id");

-- CreateIndex
CREATE INDEX "payrolls_status_idx" ON "payrolls"("status");

-- CreateIndex
CREATE INDEX "payrolls_paid_date_idx" ON "payrolls"("paid_date");

-- CreateIndex
CREATE INDEX "payroll_relates_payroll_id_idx" ON "payroll_relates"("payroll_id");

-- CreateIndex
CREATE INDEX "payroll_relates_time_entry_id_idx" ON "payroll_relates"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_relates_payroll_id_time_entry_id_key" ON "payroll_relates"("payroll_id", "time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_code_key" ON "positions"("code");

-- CreateIndex
CREATE INDEX "positions_employee_type_idx" ON "positions"("employee_type");

-- CreateIndex
CREATE INDEX "positions_is_active_idx" ON "positions"("is_active");

-- CreateIndex
CREATE INDEX "wage_rates_employee_id_idx" ON "wage_rates"("employee_id");

-- CreateIndex
CREATE INDEX "wage_rates_employee_id_effective_from_idx" ON "wage_rates"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "wage_rates_position_id_idx" ON "wage_rates"("position_id");

-- CreateIndex
CREATE INDEX "wage_rates_position_id_effective_from_idx" ON "wage_rates"("position_id", "effective_from");

-- CreateIndex
CREATE INDEX "wage_rates_effective_from_idx" ON "wage_rates"("effective_from");

-- CreateIndex
CREATE INDEX "wage_rates_effective_to_idx" ON "wage_rates"("effective_to");

-- CreateIndex
CREATE INDEX "bill_rates_contract_id_idx" ON "bill_rates"("contract_id");

-- CreateIndex
CREATE INDEX "bill_rates_position_id_idx" ON "bill_rates"("position_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_rates_contract_id_position_id_key" ON "bill_rates"("contract_id", "position_id");

-- CreateIndex
CREATE INDEX "time_sheets_work_leader_id_idx" ON "time_sheets"("work_leader_id");

-- CreateIndex
CREATE INDEX "time_sheets_employee_id_idx" ON "time_sheets"("employee_id");

-- CreateIndex
CREATE INDEX "time_sheets_work_date_idx" ON "time_sheets"("work_date");

-- CreateIndex
CREATE INDEX "time_sheets_month_period_idx" ON "time_sheets"("month_period");

-- CreateIndex
CREATE INDEX "time_sheets_status_idx" ON "time_sheets"("status");

-- CreateIndex
CREATE INDEX "time_sheets_sheet_type_idx" ON "time_sheets"("sheet_type");

-- CreateIndex
CREATE INDEX "time_entries_time_sheet_id_idx" ON "time_entries"("time_sheet_id");

-- CreateIndex
CREATE INDEX "time_entries_employee_id_idx" ON "time_entries"("employee_id");

-- CreateIndex
CREATE INDEX "time_entries_shift_type_idx" ON "time_entries"("shift_type");

-- CreateIndex
CREATE INDEX "time_entries_work_type_idx" ON "time_entries"("work_type");

-- CreateIndex
CREATE INDEX "time_entries_reference_entry_id_idx" ON "time_entries"("reference_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_branch_id_idx" ON "users"("branch_id");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_key" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_refresh_token_idx" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "sessions_access_expires_at_idx" ON "sessions"("access_expires_at");

-- CreateIndex
CREATE INDEX "sessions_refresh_expires_at_idx" ON "sessions"("refresh_expires_at");

-- CreateIndex
CREATE INDEX "work_leaders_branch_id_idx" ON "work_leaders"("branch_id");

-- CreateIndex
CREATE INDEX "work_leaders_is_active_idx" ON "work_leaders"("is_active");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_leader_id_fkey" FOREIGN KEY ("work_leader_id") REFERENCES "work_leaders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_periods" ADD CONSTRAINT "invoice_periods_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_periods" ADD CONSTRAINT "invoice_periods_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_invoice_period_id_fkey" FOREIGN KEY ("invoice_period_id") REFERENCES "invoice_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_leader_id_fkey" FOREIGN KEY ("work_leader_id") REFERENCES "work_leaders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_relates" ADD CONSTRAINT "invoice_relates_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_relates" ADD CONSTRAINT "invoice_relates_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_pay_period_id_fkey" FOREIGN KEY ("pay_period_id") REFERENCES "pay_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_relates" ADD CONSTRAINT "payroll_relates_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_relates" ADD CONSTRAINT "payroll_relates_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wage_rates" ADD CONSTRAINT "wage_rates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wage_rates" ADD CONSTRAINT "wage_rates_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_rates" ADD CONSTRAINT "bill_rates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_rates" ADD CONSTRAINT "bill_rates_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_work_leader_id_fkey" FOREIGN KEY ("work_leader_id") REFERENCES "work_leaders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_create_by_fkey" FOREIGN KEY ("create_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_time_sheet_id_fkey" FOREIGN KEY ("time_sheet_id") REFERENCES "time_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_leaders" ADD CONSTRAINT "work_leaders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

