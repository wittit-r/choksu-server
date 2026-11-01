import pg from 'pg';
import { execSync } from 'child_process';

const TEST_DB_URL = 'postgresql://postgres:postgresql@localhost:5432/choksu_test?schema=public';

export default async function globalSetup() {
    console.log('[global-setup] Creating test database choksu_test...');

    const client = new pg.Client({
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'postgresql',
        database: 'postgres',
    });

    await client.connect();

    await client.query('DROP DATABASE IF EXISTS choksu_test');
    await client.query('CREATE DATABASE choksu_test');
    await client.end();

    console.log('[global-setup] Pushing Prisma schema to test database...');

    execSync('npx prisma db push --force-reset', {
        cwd: process.cwd(),
        env: {
            ...process.env,
            DATABASE_URL: TEST_DB_URL,
            PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
        },
        stdio: 'inherit',
    });

    console.log('[global-setup] Test database ready.');
}
