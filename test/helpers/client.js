import request from 'supertest';
import app from '../../src/index.js';

// ⚠️ ใช้ server เดียวต่อ worker (แทนการให้ supertest เปิด/ปิด server ต่อ request)
// เพื่อกัน socket reuse กับ server ที่ปิดไปแล้ว → ECONNRESET / socket hang up /
// คำตอบปลอมแบบสุ่ม — ปิดท้าย suite ผ่าน disconnectPrisma() ใน helpers/db.js
export const testServer = app.listen(0);


export function createApiClient(accessToken) {
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    return {
        // Auth
        login: (data) =>
            request(testServer).post('/auth/login').send(data),

        refresh: (data) =>
            request(testServer).post('/auth/refresh').send(data),

        logout: (accessToken) =>
            request(testServer).post('/auth/logout').set({ Authorization: `Bearer ${accessToken}` }),

        me: () =>
            request(testServer).get('/auth/me').set(authHeader),

        // Users
        getUsers: (query = {}) =>
            request(testServer).get('/users').query(query).set(authHeader),

        getUserById: (id) =>
            request(testServer).get(`/users/${id}`).set(authHeader),

        createUser: (data) =>
            request(testServer).post('/users').send(data).set(authHeader),

        updateUser: (id, data) =>
            request(testServer).patch(`/users/${id}`).send(data).set(authHeader),

        // Branches
        getBranches: (query = {}) =>
            request(testServer).get('/branches').query(query).set(authHeader),

        getBranchById: (id) =>
            request(testServer).get(`/branches/${id}`).set(authHeader),

        createBranch: (data) =>
            request(testServer).post('/branches').send(data).set(authHeader),

        updateBranch: (id, data) =>
            request(testServer).patch(`/branches/${id}`).send(data).set(authHeader),

        // Positions
        getPositions: (query = {}) =>
            request(testServer).get('/positions').query(query).set(authHeader),

        getPositionById: (id) =>
            request(testServer).get(`/positions/${id}`).set(authHeader),

        createPosition: (data) =>
            request(testServer).post('/positions').send(data).set(authHeader),

        updatePosition: (id, data) =>
            request(testServer).patch(`/positions/${id}`).send(data).set(authHeader),

        // Work Leaders
        getWorkLeaders: (query = {}) =>
            request(testServer).get('/work-leaders').query(query).set(authHeader),

        getWorkLeaderById: (id) =>
            request(testServer).get(`/work-leaders/${id}`).set(authHeader),

        createWorkLeader: (data) =>
            request(testServer).post('/work-leaders').send(data).set(authHeader),

        updateWorkLeader: (id, data) =>
            request(testServer).patch(`/work-leaders/${id}`).send(data).set(authHeader),

        // Employees
        getEmployees: (query = {}) =>
            request(testServer).get('/employees').query(query).set(authHeader),

        getEmployeeById: (id) =>
            request(testServer).get(`/employees/${id}`).set(authHeader),

        createEmployee: (data) =>
            request(testServer).post('/employees').send(data).set(authHeader),

        updateEmployee: (id, data) =>
            request(testServer).patch(`/employees/${id}`).send(data).set(authHeader),

        getWages: (employeeId, query = {}) =>
            request(testServer).get(`/employees/${employeeId}/wages`).query(query).set(authHeader),

        createWage: (employeeId, data) =>
            request(testServer).post(`/employees/${employeeId}/wages`).send(data).set(authHeader),

        updateWage: (employeeId, wageId, data) =>
            request(testServer).patch(`/employees/${employeeId}/wages/${wageId}`).send(data).set(authHeader),

        getEmployeeTimeEntries: (employeeId, query = {}) =>
            request(testServer).get(`/employees/${employeeId}/time-entries`).query(query).set(authHeader),

        // Pay Period
        getPayPeriods: (query = {}) =>
            request(testServer).get('/pay-periods').query(query).set(authHeader),

        getPayPeriodById: (id) =>
            request(testServer).get(`/pay-periods/${id}`).set(authHeader),

        createPayPeriod: (data) =>
            request(testServer).post('/pay-periods').send(data).set(authHeader),

        createPayrolls: (periodId, body = {}) =>
            request(testServer).post(`/pay-periods/${periodId}/payrolls`).send(body).set(authHeader),

        cancelAllPayrolls: (periodId) =>
            request(testServer).delete(`/pay-periods/${periodId}/payrolls`).set(authHeader),

        recalculatePeriod: (periodId) =>
            request(testServer).patch(`/pay-periods/${periodId}/recalculate`).set(authHeader),

        exportPeriod: (periodId) =>
            request(testServer).post(`/pay-periods/${periodId}/export`).set(authHeader),

        closePeriod: (periodId, force = false) =>
            request(testServer).patch(`/pay-periods/${periodId}/close`).query({ force }).set(authHeader),

        reopenPeriod: (periodId) =>
            request(testServer).patch(`/pay-periods/${periodId}/reopen`).set(authHeader),

        importPeriod: (periodId) =>
            request(testServer).post(`/pay-periods/${periodId}/import`).set(authHeader),

        // Payroll
        getPayrolls: (query = {}) =>
            request(testServer).get('/payrolls').query(query).set(authHeader),

        getPayrollById: (id) =>
            request(testServer).get(`/payrolls/${id}`).set(authHeader),

        updatePayroll: (id, data) =>
            request(testServer).patch(`/payrolls/${id}`).send(data).set(authHeader),

        cancelPayroll: (id) =>
            request(testServer).delete(`/payrolls/${id}`).set(authHeader),

        recalculatePayroll: (id) =>
            request(testServer).patch(`/payrolls/${id}/recalculate`).set(authHeader),

        retroCalculate: (data) =>
            request(testServer).post('/payrolls/retro-calculate').send(data).set(authHeader),

        // Timesheet
        getTimesheets: (query = {}) =>
            request(testServer).get('/timesheets').query(query).set(authHeader),

        getTimesheetById: (id) =>
            request(testServer).get(`/timesheets/${id}`).set(authHeader),

        createWorkerTimeSheet: (data) =>
            request(testServer).post('/timesheets/worker').send(data).set(authHeader),

        createDriverTimeSheet: (data) =>
            request(testServer).post('/timesheets/driver').send(data).set(authHeader),

        updateTimeSheet: (id, data) =>
            request(testServer).patch(`/timesheets/${id}`).send(data).set(authHeader),

        deleteTimeSheet: (id) =>
            request(testServer).delete(`/timesheets/${id}`).set(authHeader),

        createWorkerTimeEntry: (sheetId, data) =>
            request(testServer).post(`/timesheets/${sheetId}/time-entries/worker`).send(data).set(authHeader),

        updateWorkerTimeEntry: (sheetId, entryId, data) =>
            request(testServer).patch(`/timesheets/${sheetId}/time-entries/${entryId}/worker`).send(data).set(authHeader),

        createDriverTimeEntry: (sheetId, data) =>
            request(testServer).post(`/timesheets/${sheetId}/time-entries/driver`).send(data).set(authHeader),

        updateDriverTimeEntry: (sheetId, entryId, data) =>
            request(testServer).patch(`/timesheets/${sheetId}/time-entries/${entryId}/driver`).send(data).set(authHeader),

        deleteTimeEntry: (sheetId, entryId) =>
            request(testServer).delete(`/timesheets/${sheetId}/time-entries/${entryId}`).set(authHeader),

        createCorrectionTimeEntry: (sheetId, data) =>
            request(testServer).post(`/timesheets/${sheetId}/time-entries/correction`).send(data).set(authHeader),

        addFile: (sheetId, data) =>
            request(testServer).post(`/timesheets/${sheetId}/files`).send(data).set(authHeader),

        removeFile: (sheetId, filePath) =>
            request(testServer).delete(`/timesheets/${sheetId}/files/${encodeURIComponent(filePath)}`).set(authHeader),

        // Raw
        raw: request(testServer),
    };
}
