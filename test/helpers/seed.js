import prisma from '../../src/databases/prisma.js';

export async function seedTestData() {
    const branch = await prisma.branch.create({
        data: { name: 'Test Branch', fullname: 'Test Branch Full' },
    });

    const workerPosition = await prisma.position.create({
        data: {
            name: 'Regular Worker',
            code: 'RW',
            employeeType: 'WORKER',
            isActive: true,
        },
    });

    const workLeader = await prisma.workLeader.create({
        data: {
            name: 'Test Work Leader',
            branchId: branch.id,
            isActive: true,
        },
    });

    const employees = [];
    for (let i = 1; i <= 5; i++) {
        const emp = await prisma.employee.create({
            data: {
                firstName: `Worker${i}`,
                lastName: 'Test',
                idCard: `10000000000${i}`,
                bankAccount: `123456789${i}`,
                shiftType: 'REGULAR',
                workLeaderId: workLeader.id,
                startDate: new Date('2025-01-01'),
                isActive: true,
            },
        });

        await prisma.wageRate.create({
            data: {
                employeeId: emp.id,
                positionId: workerPosition.id,
                dailyRate: 500,
                hourlyRate: 62.5,
                minuteRate: 1.042,
                monthlyRate: 0,
                effectiveFrom: new Date('2025-01-01'),
                effectiveTo: null,
            },
        });

        employees.push(emp);
    }

    return { branch, workerPosition, workLeader, employees };
}
