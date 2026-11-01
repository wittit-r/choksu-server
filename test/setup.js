// Per-test setup: ตั้งค่า env ให้ชี้ MySQL test DB ก่อน import ใดๆ
// vitest รัน setupFiles ก่อนทุก test file แต่หลัง globalSetup
process.env.DATABASE_URL = 'mysql://root:root@127.0.0.1:3306/choksu_test';
process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Bangkok';
