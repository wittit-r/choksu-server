import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        globalSetup: ['./test/global-setup.js'],
        setupFiles: ['./test/setup.js'],
        testTimeout: 30000,
        hookTimeout: 60000,
        fileParallelism: false,
        env: {
            NODE_ENV: 'test',
        },
    },
});
