import mysql from 'mysql2/promise';

const TEST_DB_URL_MY = 'mysql://root:root@127.0.0.1:3306/choksu_test';

export default async function globalSetup() {
    console.log('[global-setup] Creating test database choksu_test (MySQL)...');
    const my = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' });
    await my.query('DROP DATABASE IF EXISTS choksu_test');
    await my.query('CREATE DATABASE choksu_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
    await my.end();

    console.log('[global-setup] Syncing Sequelize schema to MySQL test database...');
    process.env.DATABASE_URL = TEST_DB_URL_MY;
    const { sequelize } = await import('../src/database/index.js');
    await sequelize.sync();
    await sequelize.close();

    console.log('[global-setup] Test database ready.');
}
