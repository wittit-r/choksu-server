import {
    Branch, Position, WorkLeader, Employee, WageRate,
} from '../../src/database/index.js';

/**
 * Seed ข้อมูลพื้นฐานลง MySQL test DB
 * (5 พนักงาน WORKER ค่าแรง 500/วัน effective 2025-01-01)
 */
export async function seedTestData() {
    const branch = await Branch.create({
        name: 'Test Branch', fullname: 'Test Branch Full',
    });

    const workerPosition = await Position.create({
        name: 'Regular Worker',
        code: 'RW',
        employeeType: 'WORKER',
        isActive: true,
    });

    const workLeader = await WorkLeader.create({
        name: 'Test Work Leader',
        branchId: branch.id,
        isActive: true,
    });

    const employees = [];
    for (let i = 1; i <= 5; i++) {
        const emp = await Employee.create({
            firstName: `Worker${i}`,
            lastName: 'Test',
            idCard: `10000000000${i}`,
            bankAccount: `123456789${i}`,
            shiftType: 'REGULAR',
            workLeaderId: workLeader.id,
            startDate: new Date('2025-01-01'),
            isActive: true,
        });

        await WageRate.create({
            employeeId: emp.id,
            positionId: workerPosition.id,
            dailyRate: 500,
            hourlyRate: 62.5,
            minuteRate: 1.042,
            monthlyRate: 0,
            effectiveFrom: new Date('2025-01-01'),
        });

        employees.push(emp);
    }

    return { branch, workerPosition, workLeader, employees };
}
