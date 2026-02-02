import IORedis from 'ioredis';

let redis = null;

/**
 * สร้างหรือดึง Redis connection instance
 */
const getRedis = () => {
    if (!redis) {
        redis = new IORedis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD,
            maxRetriesPerRequest: null,
        });

        // Event handlers
        redis.on('connect', () => {
            console.log('Redis connected');
        });

        redis.on('error', (err) => {
            console.error('Redis connection error:', err);
        });
    }
    return redis;
};

/**
 * ปิดการเชื่อมต่อกับ Redis
 */
const disconnectRedis = async () => {
    if (redis) {
        await redis.quit();
        redis = null;
        console.log('Redis disconnected');
    }
};

/**
 * ตรวจสอบสถานะการเชื่อมต่อกับ Redis
 */
const isRedisConnected = () => {
    return redis && redis.status === 'ready';
};

export { getRedis, disconnectRedis, isRedisConnected };
export default getRedis;