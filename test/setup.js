// Per-test setup: load .env.test ก่อน import ใดๆ
// vitest รัน setupFiles ก่อนทุก test file แต่หลัง globalSetup
// ตรงนี้ตั้งค่า env ให้ชี้ไป test DB
process.env.DATABASE_URL = 'postgresql://postgres:postgresql@localhost:5432/choksu_test?schema=public';
process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Bangkok';
