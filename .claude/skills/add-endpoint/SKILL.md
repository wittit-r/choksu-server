---
name: add-endpoint
description: >
  Workflow for adding a new API endpoint in the Choksu project
  Use when: adding a new API endpoint, creating controller/service/route,
  or any task involving controller-service-route structure
---

# Add Endpoint

## Architecture Pattern

```
Request → Middleware → Controller → Service → Database
           ↓            ↓            ↓
          Authorization Validation   Business Logic
```

## Steps

### Step 1: Create Service (if not exists)

File: `src/services/{name}.service.js`

```javascript
import prisma from "../databases/prisma.js";
import err from "../utils/error.js";

class XxxService {
    // Private methods start with _ , place them at the top after constructor

    async getXxxs({ page = 1, limit = 10, sort = 'desc', sortBy = 'createdAt', ...filters }) {
        const where = {};
        // build where clause from filters

        const [data, total] = await Promise.all([
            prisma.xxx.findMany({
                where,
                orderBy: { [sortBy]: sort },
                skip: (page - 1) * limit,
                take: limit,
                include: { /* relations */ },
            }),
            prisma.xxx.count({ where }),
        ]);

        return {
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    async getXxxById(id) {
        const xxx = await prisma.xxx.findUnique({
            where: { id },
            include: { /* relations */ },
        });
        if (!xxx) throw err.notFound({ id });
        return xxx;
    }

    async createXxx(data) {
        // validate unique constraints if needed
        return await prisma.xxx.create({ data });
    }

    async updateXxx(id, data) {
        const xxx = await prisma.xxx.findUnique({ where: { id } });
        if (!xxx) throw err.notFound({ id });
        return await prisma.xxx.update({ where: { id }, data });
    }

    async deleteXxx(id) {
        const xxx = await prisma.xxx.findUnique({ where: { id } });
        if (!xxx) throw err.notFound({ id });
        await prisma.xxx.delete({ where: { id } });
    }
}

export default new XxxService();
```

### Step 2: Create Controller

File: `src/controllers/{name}.controller.js`

```javascript
import { validate, Joi } from "../utils/validate.js";
import xxxService from "../services/xxx.service.js";

class XxxController {
    getXxxs = async (req, res) => {
        const query = validate(req.query, Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(10),
            sort: Joi.string().valid('asc', 'desc').default('desc'),
            sortBy: Joi.string().default('createdAt'),
        }));
        const result = await xxxService.getXxxs(query);
        res.status(200).json({ success: true, ...result });
    };

    getXxxById = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));
        const data = await xxxService.getXxxById(id);
        res.status(200).json({ success: true, data });
    };

    createXxx = async (req, res) => {
        const data = validate(req.body, Joi.object({
            // fields...
        }));
        const created = await xxxService.createXxx(data);
        res.status(201).json({ success: true, data: created });
    };

    updateXxx = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));
        const data = validate(req.body, Joi.object({
            // fields...
        }));
        const updated = await xxxService.updateXxx(id, data);
        res.status(200).json({ success: true, data: updated });
    };

    deleteXxx = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));
        await xxxService.deleteXxx(id);
        res.status(200).json({ success: true });
    };
}

export default new XxxController();
```

### Step 3: Create Route

File: `src/routes/{name}.routes.js`

```javascript
import express from "express";
import xxxController from "../controllers/xxx.controller.js";

const router = express.Router();

router.get('/', xxxController.getXxxs);
router.get('/:id', xxxController.getXxxById);
router.post('/', xxxController.createXxx);
router.patch('/:id', xxxController.updateXxx);
router.delete('/:id', xxxController.deleteXxx);

export default router;
```

### Step 4: Register Route

File: `src/routes/index.js`

```javascript
import xxxRoutes from "./xxx.routes.js";
router.use('/xxxs', xxxRoutes);
```

---

## Response Format

```javascript
res.status(200).json({ success: true, data });
res.status(201).json({ success: true, data });  // created
res.status(200).json({ success: true, data, pagination: { page, limit, total, totalPages } });
```

## Error Handling

Use `err` from `src/utils/error.js`:
- `err.notFound({ id })` → 404
- `err.conflict({ field }, 'message')` → 409
- `err.badRequest(null, 'message')` → 400
- `err.validation({ field }, 'message')` → 422

---

## Rules

1. **Controller** — request/response only, no business logic
2. **Service** — all business logic and database operations
3. **Validation** — validate every request with Joi
4. **Private methods** — prefix with `_`, place at the top after constructor
5. **Async errors** — Express 5 จับ rejected promise เอง ห้ามใช้ wrapper แบบ `wrap()`
6. **Error** — use `err.notFound()` / `err.conflict()` / `err.badRequest()`, never throw raw errors
7. **Indent** — 4 spaces, no tabs
8. **Pagination** — use `Promise.all` for findMany + count
9. **Transaction** — use `prisma.$transaction()` for atomic operations
