# Node.js Express API Project Guidelines

ไฟล์นี้ให้คำแนะนำเฉพาะสำหรับการทำงานกับ Backend (Node.js) ของระบบ

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js 5
- **Database**: PostgreSQL ผ่าน Prisma 7.4 (pg adapter)
- **Validation**: Joi
- **Caching**: Redis (ioredis)
- **File Storage**: Cloudflare R2 (@aws-sdk/client-s3)
- **Password Hashing**: bcryptjs
- **Testing**: Vitest + Supertest
- **Dev**: Nodemon, Prettier

## Project Structure

```
backend/
├── prisma/schema/               # Database schema (แยกตาม domain)
└── src/
    ├── index.js                 # Express server entry point
    ├── databases/               # Prisma + Redis client instances
    ├── controllers/             # Request handlers (class-based)
    ├── services/                # Business logic layer
    ├── routes/                  # API routes (*.routes.js per module, index.js รวมทั้งหมด)
    ├── middlewares/             # auth (JWT), errorHandler (wrap), upload (multer)
    ├── utils/                   # error, validate, date, password, fileUpload, prismaSelectDefault
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
    throw err.notFound({ id });
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

- `GET /employees` - ดึงรายการ (รองรับ pagination, search)
- `GET /employees/:id` - ดึงข้อมูลรายการเดียว
- `POST /employees` - สร้างใหม่
- `PATCH /employees/:id` - อัปเดตบาง fields
- `DELETE /employees/:id` - ลบ

### Query Parameters

**Pagination & Filtering:**
```
GET /employees?page=1&limit=10&search=john
```

## Security Best Practices

1. **Input Validation**: ตรวจสอบทุก request ด้วย Joi schemas
2. **SQL Injection**: Prisma ป้องกันอัตโนมัติ
3. **Authentication**: ใช้ access token และ refresh token
4. **CORS**: กำหนด allowed origins ใน production
5. **Environment Variables**: ใช้ `.env` สำหรับ sensitive data
6. **Private Methods**: ขึ้นต้นด้วย underscore (_) และไว้บนสุดของ class หลังจาก contrucror

## Common Tasks

### เพิ่ม API Endpoint ใหม่

ใช้ skill `/add-endpoint` สำหรับ workflow และ template code แบบเต็ม

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

## Business Rules Skill Sync Rule

เมื่อทำงานที่เกี่ยวข้องกับ business logic (payroll, timesheet, wage rate, retroactive, ยอดจ่าย, หักเงิน, pay period, net pay, ค่า OT, ค่าที่พัก, SSO, SLF, validation):

1. **อ่าน `/business-rules` skill ก่อนเริ่มงาน** — เพื่อเทียบ business rules ปัจจุบันกับที่จะแก้ไข/เพิ่ม
2. **ถ้าพบว่า code ที่จะเขียนแตกต่างจาก skill** — หยุดและถาม user ก่อนว่า business rule เปลี่ยนจริงหรือไม่
3. **ถ้า user ยืนยันว่าเปลี่ยนแล้ว** — อัปเดท `/business-rules` skill ให้ตรงกับ business rule ใหม่ทันที

## Skills ที่ใช้ได้

- `/add-endpoint` - สร้าง API endpoint ใหม่ (controller, service, route)
- `/prisma-db` - จัดการ database (model, migration, reset)
- `/prisma-query` - ตัวอย่าง Prisma queries
- `/validate-data` - ตรวจสอบความถูกต้องของข้อมูลก่อนใช้งาน
- `/business-rules` - Business logic knowledge base (payroll, timesheet, wage rate, calculation, validation)

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
