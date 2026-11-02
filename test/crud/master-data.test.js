import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Branch } from '../../src/database/index.js';
import IORedis from 'ioredis';

// CRUD ของ master data: branches / positions / work-leaders
// expected ทั้งหมดอ่านจากโค้ดจริง (controller + service + models)
describe('CRUD: master data (branches / positions / work-leaders)', () => {
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

    describe('branches', () => {
        it('should create a branch and return 201 with shape', async () => {
            const res = await api.createBranch({
                name: 'Main Branch',
                fullname: 'การไฟฟ้าสาขาใหญ่',
            });
            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.name).toBe('Main Branch');
            expect(res.body.data.fullname).toBe('การไฟฟ้าสาขาใหญ่');
        });

        // Branch model ไม่มี unique constraint (models.js) → สร้างชื่อซ้ำได้
        it('should allow duplicate branch names (no unique constraint)', async () => {
            const first = await api.createBranch({ name: 'DUP', fullname: 'First' });
            const second = await api.createBranch({ name: 'DUP', fullname: 'Second' });
            expect(first.status).toBe(201);
            expect(second.status).toBe(201);
            expect(second.body.data.id).not.toBe(first.body.data.id);
        });

        it('should list branches with search', async () => {
            await api.createBranch({ name: 'Alpha Branch', fullname: 'Alpha Full' });
            await api.createBranch({ name: 'Beta Branch', fullname: 'Beta Full' });

            const res = await api.getBranches({ search: 'Alpha' });
            expect(res.status).toBe(200);
            expect(res.body.pagination.total).toBe(1);
            expect(res.body.data[0].name).toBe('Alpha Branch');
        });

        it('should paginate branches', async () => {
            // seed 1 + Alpha + Beta = 3 สาขา
            await api.createBranch({ name: 'Alpha Branch', fullname: 'Alpha Full' });
            await api.createBranch({ name: 'Beta Branch', fullname: 'Beta Full' });

            const page1 = await api.getBranches({ page: 1, limit: 2 });
            expect(page1.status).toBe(200);
            expect(page1.body.data).toHaveLength(2);
            expect(page1.body.pagination).toMatchObject({
                page: 1,
                limit: 2,
                total: 3,
                totalPages: 2,
            });

            const page2 = await api.getBranches({ page: 2, limit: 2 });
            expect(page2.body.data).toHaveLength(1);
        });

        it('should return 404 when branch not found', async () => {
            const res = await api.getBranchById(9999);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('should update branch values', async () => {
            const created = await api.createBranch({ name: 'Old Name', fullname: 'Old Full' });

            // ต้องส่ง name+fullname ครบ: updateBranch กำหนด field ที่ไม่ส่งเป็น undefined
            // → Sequelize save() มองเป็น null (fullname nullable จึงหายเงียบๆ)
            const res = await api.updateBranch(created.body.data.id, {
                name: 'New Name',
                fullname: 'New Full',
            });
            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('New Name');
            expect(res.body.data.fullname).toBe('New Full');

            const fetched = await api.getBranchById(created.body.data.id);
            expect(fetched.body.data.name).toBe('New Name');
        });

        it('should return 404 when updating a missing branch', async () => {
            const res = await api.updateBranch(9999, { name: 'X', fullname: 'Y' });
            expect(res.status).toBe(404);
        });
    });

    describe('positions', () => {
        it('should create a position and return 201 with shape', async () => {
            const res = await api.createPosition({
                name: 'Night Worker',
                code: 'NW',
                employeeType: 'WORKER',
            });
            expect(res.status).toBe(201);
            expect(res.body.data).toMatchObject({
                name: 'Night Worker',
                code: 'NW',
                employeeType: 'WORKER',
                isActive: true,
            });
            expect(res.body.data.id).toBeDefined();
        });

        // (แก้แล้ว) service เช็ค code ซ้ำก่อน create → 409 CONFLICT แทน 500
        it('should return 409 on duplicate position code', async () => {
            const res = await api.createPosition({
                name: 'Another Worker',
                code: 'RW', // ซ้ำกับ seed
                employeeType: 'WORKER',
            });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CONFLICT');
        });

        it('should list positions with search and employeeType filter', async () => {
            await api.createPosition({ name: 'Driver Pos', code: 'DRV', employeeType: 'DRIVER' });

            const bySearch = await api.getPositions({ search: 'DRV' });
            expect(bySearch.status).toBe(200);
            expect(bySearch.body.pagination.total).toBe(1);
            expect(bySearch.body.data[0].code).toBe('DRV');

            const byType = await api.getPositions({ employeeType: 'DRIVER' });
            expect(byType.body.pagination.total).toBe(1);
            expect(byType.body.data[0].employeeType).toBe('DRIVER');
        });

        it('should return 404 when position not found', async () => {
            const res = await api.getPositionById(9999);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('should update position values when all fields are sent', async () => {
            const created = await api.createPosition({
                name: 'Temp Pos',
                code: 'TP',
                employeeType: 'WORKER',
            });

            const res = await api.updatePosition(created.body.data.id, {
                name: 'Renamed Pos',
                code: 'TP2',
                employeeType: 'WORKER',
                isActive: false,
            });
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({
                name: 'Renamed Pos',
                code: 'TP2',
                isActive: false,
            });
        });

        // (แก้แล้ว) update กำหนดเฉพาะ field ที่ส่ง → PATCH บางส่วนได้ ค่าเดิมคงเหมือนเดิม
        it('should allow partial update — untouched fields keep their values', async () => {
            const created = await api.createPosition({
                name: 'Partial Pos',
                code: 'PP',
                employeeType: 'WORKER',
            });

            const res = await api.updatePosition(created.body.data.id, { isActive: false });
            expect(res.status).toBe(200);
            expect(res.body.data.isActive).toBe(false);
            expect(res.body.data.name).toBe('Partial Pos');
            expect(res.body.data.code).toBe('PP');
            expect(res.body.data.employeeType).toBe('WORKER');
        });
    });

    describe('work-leaders', () => {
        it('should return 422 when branchId is missing', async () => {
            const res = await api.createWorkLeader({ name: 'No Branch Leader' });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details).toHaveProperty('branchId');
        });

        it('should return 422 when branchId does not exist', async () => {
            const res = await api.createWorkLeader({
                name: 'Ghost Leader',
                branchId: 9999,
            });
            expect(res.status).toBe(422);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.message).toBe('ไม่พบสาขา');
        });

        it('should create a work leader and return 201 with shape', async () => {
            const res = await api.createWorkLeader({
                name: 'New Leader',
                refNo: 'R-001',
                branchId: seed.branch.id,
            });
            expect(res.status).toBe(201);
            expect(res.body.data).toMatchObject({
                name: 'New Leader',
                refNo: 'R-001',
                branchId: seed.branch.id,
                isActive: true,
            });
            expect(res.body.data.id).toBeDefined();
            // หมายเหตุ: response ของ create ไม่มี object branch (include ใช้ตอน list/get เท่านั้น)
        });

        it('should filter work leaders by branchId and include branch', async () => {
            const branch2 = await Branch.create({ name: 'Branch 2', fullname: 'Branch Two' });
            await api.createWorkLeader({ name: 'Leader B2', branchId: branch2.id });

            const res = await api.getWorkLeaders({ branchId: branch2.id });
            expect(res.status).toBe(200);
            expect(res.body.pagination.total).toBe(1);
            expect(res.body.data[0].name).toBe('Leader B2');
            // include branch ใน response
            expect(res.body.data[0].branch).toMatchObject({
                id: branch2.id,
                name: 'Branch 2',
            });
        });

        it('should filter work leaders by isActive=false', async () => {
            await api.createWorkLeader({
                name: 'Inactive Leader',
                branchId: seed.branch.id,
                isActive: false,
            });

            const res = await api.getWorkLeaders({ isActive: false });
            expect(res.status).toBe(200);
            expect(res.body.pagination.total).toBe(1);
            expect(res.body.data[0].name).toBe('Inactive Leader');
        });

        it('should get work leader by id with branch included, and 404 when missing', async () => {
            const res = await api.getWorkLeaderById(seed.workLeader.id);
            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('Test Work Leader');
            expect(res.body.data.branch).toMatchObject({ id: seed.branch.id });

            const missing = await api.getWorkLeaderById(9999);
            expect(missing.status).toBe(404);
        });

        it('should update work leader values (must send name + branchId + isActive)', async () => {
            const res = await api.updateWorkLeader(seed.workLeader.id, {
                name: 'Renamed Leader',
                branchId: seed.branch.id,
                isActive: true,
            });
            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('Renamed Leader');
            expect(res.body.data.branch.id).toBe(seed.branch.id);
        });
    });
});
