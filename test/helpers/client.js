import request from 'supertest';
import app from '../../src/index.js';

export function createApiClient(accessToken) {
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    return {
        // Pay Period
        getPayPeriods: (query = {}) =>
            request(app).get('/pay-periods').query(query).set(authHeader),

        getPayPeriodById: (id) =>
            request(app).get(`/pay-periods/${id}`).set(authHeader),

        createPayPeriod: (data) =>
            request(app).post('/pay-periods').send(data).set(authHeader),

        createPayrolls: (periodId, body = {}) =>
            request(app).post(`/pay-periods/${periodId}/payrolls`).send(body).set(authHeader),

        cancelAllPayrolls: (periodId) =>
            request(app).delete(`/pay-periods/${periodId}/payrolls`).set(authHeader),

        recalculatePeriod: (periodId) =>
            request(app).patch(`/pay-periods/${periodId}/recalculate`).set(authHeader),

        exportPeriod: (periodId) =>
            request(app).post(`/pay-periods/${periodId}/export`).set(authHeader),

        closePeriod: (periodId, force = false) =>
            request(app).patch(`/pay-periods/${periodId}/close`).query({ force }).set(authHeader),

        reopenPeriod: (periodId) =>
            request(app).patch(`/pay-periods/${periodId}/reopen`).set(authHeader),

        importPeriod: (periodId) =>
            request(app).post(`/pay-periods/${periodId}/import`).set(authHeader),

        // Payroll
        getPayrolls: (query = {}) =>
            request(app).get('/payrolls').query(query).set(authHeader),

        getPayrollById: (id) =>
            request(app).get(`/payrolls/${id}`).set(authHeader),

        updatePayroll: (id, data) =>
            request(app).patch(`/payrolls/${id}`).send(data).set(authHeader),

        cancelPayroll: (id) =>
            request(app).delete(`/payrolls/${id}`).set(authHeader),

        recalculatePayroll: (id) =>
            request(app).patch(`/payrolls/${id}/recalculate`).set(authHeader),

        retroCalculate: (data) =>
            request(app).post('/payrolls/retro-calculate').send(data).set(authHeader),

        // Timesheet
        getTimesheets: (query = {}) =>
            request(app).get('/timesheets').query(query).set(authHeader),

        getTimesheetById: (id) =>
            request(app).get(`/timesheets/${id}`).set(authHeader),

        createWorkerTimeSheet: (data) =>
            request(app).post('/timesheets/worker').send(data).set(authHeader),

        createDriverTimeSheet: (data) =>
            request(app).post('/timesheets/driver').send(data).set(authHeader),

        updateTimeSheet: (id, data) =>
            request(app).patch(`/timesheets/${id}`).send(data).set(authHeader),

        createWorkerTimeEntry: (sheetId, data) =>
            request(app).post(`/timesheets/${sheetId}/time-entries/worker`).send(data).set(authHeader),

        updateWorkerTimeEntry: (sheetId, entryId, data) =>
            request(app).patch(`/timesheets/${sheetId}/time-entries/${entryId}/worker`).send(data).set(authHeader),

        deleteTimeEntry: (sheetId, entryId) =>
            request(app).delete(`/timesheets/${sheetId}/time-entries/${entryId}`).set(authHeader),

        createCorrectionTimeEntry: (sheetId, data) =>
            request(app).post(`/timesheets/${sheetId}/time-entries/correction`).send(data).set(authHeader),

        // Raw
        raw: request(app),
    };
}
