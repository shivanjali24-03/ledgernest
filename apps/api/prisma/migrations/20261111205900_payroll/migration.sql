-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "gender" TEXT,
    "date_of_joining" DATE NOT NULL,
    "date_of_leaving" DATE,
    "pan" TEXT,
    "uan" TEXT,
    "esi_number" TEXT,
    "state_code" TEXT,
    "basic" BIGINT NOT NULL,
    "hra" BIGINT NOT NULL DEFAULT 0,
    "special_allowance" BIGINT NOT NULL DEFAULT 0,
    "other_allowance" BIGINT NOT NULL DEFAULT 0,
    "pf" BOOLEAN NOT NULL DEFAULT true,
    "pf_capped" BOOLEAN NOT NULL DEFAULT true,
    "esi" BOOLEAN NOT NULL DEFAULT true,
    "pt" BOOLEAN NOT NULL DEFAULT true,
    "tax_regime" TEXT NOT NULL DEFAULT 'new',
    "monthly_tds" BIGINT,
    "bank_account_name" TEXT,
    "bank_account_number" TEXT,
    "ifsc" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "gross" BIGINT NOT NULL DEFAULT 0,
    "deductions" BIGINT NOT NULL DEFAULT 0,
    "net" BIGINT NOT NULL DEFAULT 0,
    "employer_cost" BIGINT NOT NULL DEFAULT 0,
    "journal_entry_id" UUID,
    "paid_on" DATE,
    "pay_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pay_run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "days_in_month" INTEGER NOT NULL,
    "days_paid" DECIMAL(4,1) NOT NULL,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "employer" JSONB NOT NULL,
    "gross" BIGINT NOT NULL,
    "total_deductions" BIGINT NOT NULL,
    "net" BIGINT NOT NULL,
    "employer_cost" BIGINT NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_id_key" ON "employees"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_code_key" ON "employees"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "pay_runs_organization_id_id_key" ON "pay_runs"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_runs_organization_id_month_key" ON "pay_runs"("organization_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_organization_id_id_key" ON "payslips"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_pay_run_id_employee_id_key" ON "payslips"("pay_run_id", "employee_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_organization_id_pay_run_id_fkey" FOREIGN KEY ("organization_id", "pay_run_id") REFERENCES "pay_runs"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_status_check" CHECK ("status" IN ('draft', 'posted', 'paid'));
ALTER TABLE "employees" ADD CONSTRAINT "employees_tax_regime_check" CHECK ("tax_regime" IN ('new', 'old'));
ALTER TABLE "employees" ADD CONSTRAINT "employees_salary_check" CHECK ("basic" >= 0 AND "hra" >= 0 AND "special_allowance" >= 0 AND "other_allowance" >= 0);

-- Payroll's system accounts
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_check";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('retained_earnings', 'opening_balance_equity', 'fx_realised', 'fx_unrealised', 'interest_income', 'round_off', 'rcm_payable', 'goods_on_challan', 'grni', 'salaries', 'employer_contributions', 'salaries_payable', 'pf_payable', 'esi_payable', 'pt_payable', 'tds_salary_payable'));
