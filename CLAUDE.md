# Node.js Express API Project Guidelines

ไฟล์นี้ให้คำแนะนำเฉพาะสำหรับการทำงานกับ Backend (Node.js) ของระบบ

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL ผ่าน Prisma 7.3
- **Validation**: Joi
- **Caching**: Redis

## Project Structure

```
backend/
├── prisma/                      # Prisma Configuration & Schema
│   └── schema/                  # Database schema files
└── src/
    ├── index.js                 # Express server entry point
    ├── databases/               # Database connections
    ├── controllers/             # Request handlers (class-based)
    ├── services/                # Business logic layer
    ├── middlewares/             # Custom middleware (auth, error handler)
    ├── routes/                  # API routes definitions
    ├── utils/                   # Helper utilities
    └── libraries/               # External libraries
```

## Code Conventions

### Indentation
- **ใช้ 4 spaces** (ไม่ใช้ tabs)
- ใช้กับทุกไฟล์: `.js`, `.json`, `.prisma`

### Architecture Pattern

โปรเจ็กต์ใช้ **Layered Architecture** แยกความรับผิดชอบชัดเจน:

```
Request → Middleware -→ Controller → Service → Database
           ↓             ↓            ↓
          Authorization Validation   Business Logic
```

## Controller & Service Layer

### Controller (Request Handler)

Controllers รับผิดชอบการจัดการ request/response **เท่านั้น** ไม่มี business logic

### Service (Business Logic)

Services รับผิดชอบ business logic และ database operations ทั้งหมด
**ดูเพิ่มเติม**: ใช้ `/prisma-query` สำหรับตัวอย่าง queries

## Routes
จัดการ route ต่างๆ

## Error Handling

### Async Wrapper Middleware

ไฟล์: `src/middlewares/errorHandler.js`
`wrap()` function จะจัดการ async errors อัตโนมัติ:

### Custom Error Classes

ไฟล์: `src/utils/error.js`
พื้นฐานการสร้าง error เพื่อ throw ให้เป็นรูปแบบมาตรฐานเดียวกัน


ตัวอย่างการใช้งานใน Service:

```javascript
import err from "../utils/error.js";

// Throw not found error
if (!employee) {
    throw err.notFound("ไม่พบพนักงาน");
}
```

## Validation

### Joi Validation Helpers

ไฟล์: `src/utils/validate.js`
ใช้ validate และ Joi ในการตรวจสอบและกรองข้อมูลที่ถูกต้อง
**ดูเพิ่มเติม**: ใช้ `/validate-data` สำหรับตัวอย่างการใช้งาน

## Response Format

### Success Response

```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "ข้อมูลไม่ถูกต้อง",
    "details": {
      "email": "รูปแบบอีเมลไม่ถูกต้อง"
    }
  }
}
```

## API Design Principles

### RESTful Conventions

- `GET /api/employees` - ดึงรายการ (รองรับ pagination, search)
- `GET /api/employees/:id` - ดึงข้อมูลรายการเดียว
- `POST /api/employees` - สร้างใหม่
- `PATCH /api/employees/:id` - อัปเดตบาง fields
- `DELETE /api/employees/:id` - ลบ

### Query Parameters

**Pagination & Filtering:**
```
GET /api/employees?page=1&limit=10&search=john
```

## Security Best Practices

1. **Input Validation**: ตรวจสอบทุก request ด้วย Joi schemas
2. **SQL Injection**: Prisma ป้องกันอัตโนมัติ
3. **Authentication**: ใช้ JWT tokens
4. **CORS**: กำหนด allowed origins ใน production
5. **Environment Variables**: ใช้ `.env` สำหรับ sensitive data

## Common Tasks

### เพิ่ม API Endpoint ใหม่

1. **สร้าง Database Model** (ถ้าต้องการ):
   ```
   /prisma-db create model
   ```

2. **สร้าง Service** (`src/services/xxx.service.js`):
   ```javascript
   import prisma from "../databases/prisma.js";
   import err from "../utils/error.js";

   class XxxService {
       async getXxxs(query) {
           const [data, total] = await Promise.all([
               prisma.xxx.findMany({ ... }),
               prisma.xxx.count({ ... }),
           ]);
           return { data, pagination: { ... } };
       }

       async getXxxById(id) {
           const xxx = await prisma.xxx.findUnique({ where: { id } });
           if (!xxx) throw err.notFound("ไม่พบข้อมูล");
           return xxx;
       }
   }

   export default new XxxService();
   ```

3. **สร้าง Controller** (`src/controllers/xxx.controller.js`):
   ```javascript
   import { validate, Joi } from "../utils/validate.js";
   import xxxService from "../services/xxx.service.js";

   class XxxController {
       getXxxs = async (req, res) => {
           const query = validate(req.query, Joi.object({ ... }));
           const result = await xxxService.getXxxs(query);
           res.status(200).json({ status: "success", ...result });
       };
   }

   export default new XxxController();
   ```

4. **เพิ่ม Routes** (`src/routes/index.js`):
   ```javascript
   import xxxController from "../controllers/xxx.controller.js";
   router.get("/xxx", wrap(xxxController.getXxxs));
   ```

### เปลี่ยนแปลง Database Schema

ใช้ skill `/prisma-db` สำหรับจัดการ database:

```
/prisma-db modify model <model_name>
/prisma-db migrate <migration_name>
```

### Prisma Queries

ดูตัวอย่าง queries ที่ `/prisma-query`

## Testing

```javascript
// tests/employee.test.js
import request from 'supertest';
import app from '../src/index.js';

describe('Employee API', () => {
    it('should fetch all employees', async () => {
        const res = await request(app)
            .get('/api/employees')
            .expect(200);

        expect(res.body.status).toBe('success');
        expect(res.body.data).toBeInstanceOf(Array);
    });

    it('should create new employee', async () => {
        const res = await request(app)
            .post('/api/employees')
            .send({ name: 'Test', email: 'test@example.com' })
            .expect(201);

        expect(res.body.data.name).toBe('Test');
    });
});
```

## Useful Commands

```bash
# Development
npm run dev              # Start dev server

# Prisma Database (ใช้ skill /prisma-db แทน)
/prisma-db studio        # Open Prisma Studio
/prisma-db reset         # Reset database (development only)
```

## Skills ที่ใช้ได้

- `/prisma-db` - จัดการ database (model, migration, reset)
- `/prisma-query` - ตัวอย่าง Prisma queries
- `/validate-data` - ตรวจสอบความถูกต้องของข้อมูลก่อนใช้งาน
