import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Position, Employee, WageRate } from '../../src/database/index.js';
import IORedis from 'ioredis';

// CRUD ของ employees + wage rates — expected อ่านจากโค้ดจริง
describe('CRUD: employees + wage rates', () => {
    let redis, api, seed;

    beforeAll(() => {
        redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
    });

    beforeEach(async () => {
        await cleanDatabase();
        const keys = await redis.keys('auth:access:*');
        if (keys.length > 0) await redis.del(...keys);

        const { accessToken } = await createTestAuth();
        api = createApiClient(accessToken);
        seed = await seedTestData();
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    /** สร้างพนักงาน DRIVER (position + employee + wage rate) สำหรับทดสอบ filter employeeType */
    async function createDriver() {
        const driverPosition = await Position.create({
            name: 'Driver',
            code: 'DRV',
            employeeType: 'DRIVER',
            isActive: true,
        });
        const driver = await Employee.create({
            firstName: 'Driver1',
            lastName: 'Test',
            idCard: '2000000000001',
            shiftType: 'REGULAR',
            workLeaderId: null, // Driver ไม่มีหัวหน้างาน
            startDate: new Date('2025-01-01'),
            isActive: true,
        });
        await WageRate.create({
            employeeId: driver.id,
            positionId: driverPosition.id,
            dailyRate: 0,
            hourlyRate: 0,
            minuteRate: 0,
            monthlyRate: 15000,
            effectiveFrom: new Date('2025-01-01'),
        });
        return { driverPosition, driver };
    }

    describe('employees', () => {
        it('should create an employee and return 201 with shape', async () => {
            const res = await api.createEmployee({
                firstName: 'New',
                lastName: 'Employee',
                idCard: '3100000000001',
                shiftType: 'REGULAR',
                workLeaderId: seed.workLeader.id,
                startDate: '2025-06-01',
            });
            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.firstName).toBe('New');
            expect(res.body.data.isActive).toBe(true);
            // workLeader include ตาม select ของ service
            expect(res.body.data.workLeader).toMatchObject({ id: seed.workLeader.id, name: 'Test Work Leader' });
            expect(res.body.data.workLeader.branch).toMatchObject({ id: seed.branch.id });
            // ยังไม่มี wage rate → position เป็น null
            expect(res.body.data.position).toBeNull();
        });

        // (แก้แล้ว) service เช็ค idCard ซ้ำก่อน create → 409 แทน 500
        it('should return 409 on duplicate idCard', async () => {
            const res = await api.createEmployee({
                firstName: 'Dup',
                lastName: 'Card',
                idCard: seed.employees[0].idCard, // ซ้ำกับ seed
                shiftType: 'REGULAR',
                workLeaderId: seed.workLeader.id,
                startDate: '2025-06-01',
            });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CONFLICT');
        });

        it('should search employees by firstName', async () => {
            const res = await api.getEmployees({ search: 'Worker1' });
            expect(res.status).toBe(200);
            expect(res.body.pagination.total).toBe(1);
            expect(res.body.data[0].firstName).toBe('Worker1');
        });

        it('should filter employees by isActive', async () => {
            await api.updateEmployee(seed.employees[4].id, { isActive: false });

            const res = await api.getEmployees({ isActive: false });
            expect(res.status).toBe(200);
            expect(res.body.pagination.total).toBe(1);
            expect(res.body.data[0].id).toBe(seed.employees[4].id);

            const activeRes = await api.getEmployees({ isActive: true });
            expect(activeRes.body.pagination.total).toBe(4);
        });

        it('should filter employees by workLeaderId', async () => {
            const res = await api.getEmployees({ workLeaderId: seed.workLeader.id });
            expect(res.status).toBe(200);
            expect(res.body.pagination.total).toBe(5);
        });

        it('should filter employees by employeeType (via active wage rate)', async () => {
            const { driver } = await createDriver();

            const drivers = await api.getEmployees({ employeeType: 'DRIVER' });
            expect(drivers.status).toBe(200);
            expect(drivers.body.pagination.total).toBe(1);
            expect(drivers.body.data[0].id).toBe(driver.id);
            // position ถูก flatten จาก wage rate ล่าสุดที่ active
            expect(drivers.body.data[0].position).toMatchObject({ employeeType: 'DRIVER' });

            const workers = await api.getEmployees({ employeeType: 'WORKER' });
            expect(workers.body.pagination.total).toBe(5);
        });

        it('should paginate employees', async () => {
            const res = await api.getEmployees({ page: 2, limit: 2 });
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.pagination).toMatchObject({
                page: 2,
                limit: 2,
                total: 5,
                totalPages: 3,
            });
        });

        it('should update employee phone/isActive', async () => {
            const res = await api.updateEmployee(seed.employees[0].id, {
                phone: '0812345678',
                isActive: false,
            });
            expect(res.status).toBe(200);
            expect(res.body.data.phone).toBe('0812345678');
            expect(res.body.data.isActive).toBe(false);

            const fetched = await api.getEmployeeById(seed.employees[0].id);
            expect(fetched.body.data.phone).toBe('0812345678');
        });

        it('should return 404 when updating a missing employee', async () => {
            const res = await api.updateEmployee(9999, { phone: '0812345678' });
            expect(res.status).toBe(404);
        });

        it('should return 404 when employee not found', async () => {
            const res = await api.getEmployeeById(9999);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('wage rates', () => {
        // FINDING: POST /employees/:id/wages ตอบ 200 ไม่ใช่ 201 (employee.controller.js createWage)
        it('should create a wage and return 201 with position included', async () => {
            const res = await api.createWage(seed.employees[0].id, {
                positionId: seed.workerPosition.id,
                dailyRate: 600,
                hourlyRate: 75,
                minuteRate: 1.25,
                monthlyRate: 0,
                effectiveFrom: '2025-07-01',
                effectiveTo: null,
                note: 'ปรับขึ้นค่าแรง',
            });
            expect(res.status).toBe(201);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.dailyRate).toBe(600);
            // shape ของ _getWageWithPosition: position มีแค่ name + employeeType
            expect(res.body.data.position).toEqual({
                name: 'Regular Worker',
                employeeType: 'WORKER',
            });
        });

        it('should return 422 when positionId does not exist', async () => {
            const res = await api.createWage(seed.employees[0].id, {
                positionId: 9999,
                dailyRate: 500,
                hourlyRate: 62.5,
                minuteRate: 1.042,
                monthlyRate: 0,
                effectiveFrom: '2025-07-01',
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details.positionId).toBe('ไม่พบตำแหน่งงาน');
        });

        it('should return 404 when employee does not exist', async () => {
            const res = await api.createWage(9999, {
                positionId: seed.workerPosition.id,
                dailyRate: 500,
                hourlyRate: 62.5,
                minuteRate: 1.042,
                monthlyRate: 0,
                effectiveFrom: '2025-07-01',
            });
            expect(res.status).toBe(404);
        });

        // (แก้แล้ว) createWage validate effectiveTo > effectiveFrom เหมือน updateWage
        it('should return 422 when effectiveTo is before effectiveFrom on create', async () => {
            const res = await api.createWage(seed.employees[0].id, {
                positionId: seed.workerPosition.id,
                dailyRate: 500,
                hourlyRate: 62.5,
                minuteRate: 1.042,
                monthlyRate: 0,
                effectiveFrom: '2025-07-01',
                effectiveTo: '2025-06-01',
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('should return 422 when updating a wage with effectiveTo before effectiveFrom', async () => {
            const created = await api.createWage(seed.employees[0].id, {
                positionId: seed.workerPosition.id,
                dailyRate: 500,
                hourlyRate: 62.5,
                minuteRate: 1.042,
                monthlyRate: 0,
                effectiveFrom: '2025-07-01',
            });

            const res = await api.updateWage(seed.employees[0].id, created.body.data.id, {
                effectiveFrom: '2025-07-01',
                effectiveTo: '2025-06-01',
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details.effectiveTo).toBe('วันที่สิ้นสุดต้องมากกว่าวันที่เริ่มต้น');
        });

        it('should list wages sorted by effectiveFrom', async () => {
            await api.createWage(seed.employees[0].id, {
                positionId: seed.workerPosition.id,
                dailyRate: 600,
                hourlyRate: 75,
                minuteRate: 1.25,
                monthlyRate: 0,
                effectiveFrom: '2025-03-01',
            });
            // seed มี wage effectiveFrom 2025-01-01 อยู่แล้ว 1 รายการ

            const asc = await api.getWages(seed.employees[0].id, { sortBy: 'effectiveFrom', sort: 'asc' });
            expect(asc.status).toBe(200);
            expect(asc.body.pagination.total).toBe(2);
            expect(new Date(asc.body.data[0].effectiveFrom).getTime())
                .toBeLessThan(new Date(asc.body.data[1].effectiveFrom).getTime());
            expect(asc.body.data[0].dailyRate).toBe(500); // ของเดิม (ม.ค.)

            const desc = await api.getWages(seed.employees[0].id, { sortBy: 'effectiveFrom', sort: 'desc' });
            expect(desc.body.data[0].dailyRate).toBe(600); // อันใหม่ (มี.ค.)
        });
    });
});
