/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__integration__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // NeoFS calls can take time on public networks
  testTimeout: 180000,
};

