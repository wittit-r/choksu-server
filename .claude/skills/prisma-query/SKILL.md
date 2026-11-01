---
name: prisma-query
description: Help write Prisma queries - findMany, create, update, delete, relations
---

# Prisma Query Helper

Help write basic Prisma queries

## Usage

Invoke with: `/prisma-query`

## Common Queries

### 1. Find (findMany)

**Basic:**
```javascript
const employees = await prisma.employee.findMany();
```

**With pagination & filter & sort:**
```javascript
const [employees, total] = await Promise.all([
    prisma.employee.findMany({
        where: {
            isActive: true,
            ...(search && {
                name: { contains: search, mode: 'insensitive' }
            }),
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sort },
    }),
    prisma.employee.count({ where }),
]);
```

**Find by ID:**
```javascript
const employee = await prisma.employee.findUnique({
    where: { id },
    include: { user: true },
});
```

### 2. Create (create)

```javascript
const employee = await prisma.employee.create({
    data: {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '0123456789',
    },
});
```

**Create with relation:**
```javascript
const employee = await prisma.employee.create({
    data: {
        name: 'John Doe',
        email: 'john@example.com',
        user: {
            create: {
                username: 'john',
                password: 'hashed_password',
            },
        },
    },
});
```

### 3. Update (update)

```javascript
const employee = await prisma.employee.update({
    where: { id },
    data: {
        name: 'Jane Doe',
        email: 'jane@example.com',
    },
});
```

### 4. Delete (delete)

**Hard delete:**
```javascript
await prisma.employee.delete({
    where: { id },
});
```

**Soft delete (recommended):**
```javascript
await prisma.employee.update({
    where: { id },
    data: { isActive: false },
});
```

### 5. Relations

**Include relations:**
```javascript
const employees = await prisma.employee.findMany({
    include: {
        user: true,
        department: {
            select: { id: true, name: true },
        },
    },
});
```

### 6. Transaction

```javascript
const result = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({
        data: { name: 'John', email: 'john@example.com' }
    });

    const user = await tx.user.create({
        data: { username: 'john', employeeId: employee.id }
    });

    return { employee, user };
});
```

## Complete Service Layer Example

```javascript
import prisma from "../databases/prisma.js";
import err from "../utils/error.js";

class EmployeeService {
    async getEmployees({ page = 1, limit = 10, search }) {
        const where = {
            isActive: true,
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ],
            }),
        };

        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.employee.count({ where }),
        ]);

        return {
            data: employees,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    async getEmployeeById(id) {
        const employee = await prisma.employee.findUnique({
            where: { id },
            include: { user: true },
        });

        if (!employee) {
            throw err.notFound("Employee not found");
        }

        return employee;
    }

    async createEmployee(data) {
        const existing = await prisma.employee.findUnique({
            where: { email: data.email },
        });

        if (existing) {
            throw err.conflict("Email already exists");
        }

        return await prisma.employee.create({ data });
    }

    async updateEmployee(id, data) {
        await this.getEmployeeById(id);
        return await prisma.employee.update({ where: { id }, data });
    }

    async deleteEmployee(id) {
        await this.getEmployeeById(id);
        await prisma.employee.update({
            where: { id },
            data: { isActive: false },
        });
    }
}

export default new EmployeeService();
```

## Error Codes

- `P2002` - Duplicate data (unique constraint)
- `P2025` - Not found
- `P2003` - Foreign key error
