---
name: validate-data
description: Help validate data with Joi validation
---

# Validation Helper

Validate request/response data with Joi

## Features

The validation system works automatically with:

1. **Deep Trim** - Trim spaces from all fields
2. **Strip Unknown Fields** - Remove fields not specified in schema (whitelist)
3. **Coerce Types** - Automatically convert data types (string → number/boolean)
4. **Show All Errors** - Display all errors at once (not stop at first error)

## Examples

### Import and use in Controller

```javascript
import { validate, Joi } from "../utils/validate.js";
import xxxService from "../services/xxx.service.js";

class XxxController {
    // List (with pagination, filter, sort)
    getXxxs = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('name', 'createdAt').default('createdAt'),
            }),
        );

        const { data, pagination } = await xxxService.getXxxs(query);

        res.status(200).json({
            success: true,
            data,
            pagination,
        });
    }

    // Create new
    createXxx = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                // String types
                name: Joi.string().required(),
                email: Joi.string().email(),
                description: Joi.string().allow("", null),

                // Number types
                age: Joi.number().integer().min(18).max(100),
                price: Joi.number().precision(2),

                // Boolean
                isActive: Joi.boolean().default(true),

                // Arrays
                tags: Joi.array().items(Joi.string()),

                // Objects
                address: Joi.object({
                    street: Joi.string().required(),
                    city: Joi.string().required(),
                    zipCode: Joi.string(),
                }),

                // Enum/Valid values
                status: Joi.string().valid('pending', 'active', 'inactive').default('pending'),

                // Optional fields
                nickname: Joi.string().optional(),

                // Custom types
                phone: Joi.phone(),
                workTime: Joi.time(),
                idCard: Joi.thaiId(),

                // Dates
                startDate: Joi.date(),
                endDate: Joi.date().greater(Joi.ref('startDate')),
            }),
        );

        const xxx = await xxxService.createXxx(body);

        res.status(201).json({
            success: true,
            data: xxx,
        });
    }

    // Update (same pattern)
    updateXxx = async (req, res) => {
        const { id } = req.params;
        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string(),
                email: Joi.string().email(),
                // All fields are optional for update
            }),
        );

        const xxx = await xxxService.updateXxx(id, body);

        res.status(200).json({
            success: true,
            data: xxx,
        });
    }
}

export default new XxxController();
```

### Basic Joi Schemas

```javascript
// String
Joi.string()              // general string
Joi.string().required()   // required
Joi.string().min(3)       // at least 3 characters
Joi.string().max(50)      // at most 50 characters
Joi.string().email()      // email format
Joi.string().uri()        // URL format
Joi.string().pattern(/^[A-Z]/)  // starts with uppercase

// Number
Joi.number()              // general number
Joi.number().integer()    // integer
Joi.number().min(0)       // minimum value 0
Joi.number().max(100)     // maximum value 100
Joi.number().positive()   // positive only
Joi.number().precision(2) // 2 decimal places

// Boolean
Joi.boolean()             // true/false
Joi.boolean().default(false)  // default = false

// Array
Joi.array()               // array
Joi.array().items(Joi.string())  // array of strings
Joi.array().min(1)        // at least 1 item
Joi.array().unique()      // values must be unique

// Object
Joi.object({
    name: Joi.string().required(),
    age: Joi.number(),
})

// Enum/Valid values
Joi.string().valid('a', 'b', 'c')  // allowed values
Joi.number().valid(10, 20, 30)

// Optional
Joi.string().optional()    // not required (default)
Joi.string().allow("", null)  // allow empty/null

// Default values
Joi.number().default(0)
Joi.string().default("N/A")

// References
Joi.date().greater(Joi.ref('startDate'))  // endDate > startDate

// Phone
Joi.phone()  // 0xxxxxxxxx (9-10 digits)

// Time
Joi.time()  // HH:mm:ss format

// Thai ID card
Joi.thaiId()  // 13 digits

// Custom validation
Joi.string().custom((value, helpers) => {
    if (!isValid(value)) {
        return helpers.error('any.invalid');
    }
    return value;
})
```

## Error Response Format

When validation fails, returns this error format:

**Status:** 400 Bad Request

```json
{
    "success": false,
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "ข้อมูลไม่ถูกต้อง",
        "details": {
            "email": "must be a valid email",
            "age": "must be greater than or equal to 18",
            "address.city": "is required"
        }
    }
}
```
