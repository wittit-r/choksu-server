---
name: prisma-db
description: Manage Prisma database - create model, migration, schema changes
---

# Prisma Database Management Skill

Help manage Prisma database, models, and migrations

## Usage

Invoke with: `/prisma-db`

## Supported Commands

### 1. Create New Model

Create a new model in Prisma schema with migration

**How to use:**
```
/prisma-db create model
```

You will be asked for the model name and fields

**Example:**
- Model name: `Product`
- Fields:
  - `name: String` (required)
  - `price: Decimal` (required)
  - `description: String?` (optional)
  - `categoryId: String` (relation to Category)

Result:
1. Create file `prisma/schema/product.prisma`
2. Run `npx prisma migrate dev --name create_product`
3. Run `npx prisma generate`

### 2. Modify Model

Add/delete/edit fields in existing model

**How to use:**
```
/prisma-db modify model <model_name>
```

**Example:**
```
/prisma-db modify model Employee
```

You will be asked what you want to:
- Add new field
- Delete field
- Edit field

### 3. Create Migration

Create migration from schema changes

**How to use:**
```
/prisma-db migrate <migration_name>
```

**Example:**
```
/prisma-db migrate add_phone_to_employee
```

Will do:
1. `npx prisma migrate dev --name add_phone_to_employee`
2. `npx prisma generate`

### 4. Reset Database (Caution! Deletes all data)

Drop and recreate database (development only)

**How to use:**
```
/prisma-db reset
```

**Warning:** This command will delete all data in the database!

Will do:
1. `npx prisma migrate reset`
2. Confirm before deletion

### 5. Open Prisma Studio

Open GUI to view and edit data

**How to use:**
```
/prisma-db studio
```

### 6. Update Prisma Client

Generate new Prisma Client (after editing schema)

**How to use:**
```
/prisma-db generate
```

### 7. Check Schema Status

View schema and migrations status

**How to use:**
```
/prisma-db status
```

## Schema Structure in Project

- `prisma/schema/_base.prisma` - Base configuration
- `prisma/schema/user.prisma` - User models
- `prisma/schema/employee.prisma` - Employee models
- `prisma/schema/*.prisma` - Other files

When creating a new model, a new file will be created in `prisma/schema/`

## Cautions

1. **Production**: Do not use `reset` in production
2. **Migration**: Do not edit migration files that have been created
3. **Schema**: After editing schema, must run `migrate dev` and `generate`

## Basic Model Example

```prisma
model Example {
    id        String   @id @default(uuid())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    isActive  Boolean  @default(true)

    // Fields
    name      String

    // Relations
    userId    String?
    user      User?    @relation(fields: [userId], references: [id])

    @@index([name])
    @@index([isActive])
}
```

## Standard Workflow

1. Edit/create model in `prisma/schema/`
2. Run `/prisma-db migrate <name>`
3. Use model in services: `src/services/`
4. If need to change schema → go back to step 1
