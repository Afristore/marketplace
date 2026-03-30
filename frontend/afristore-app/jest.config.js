const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // Handle @/ path alias (next/jest reads tsconfig paths, but be explicit)
    '^@/(.*)$': '<rootDir>/src/$1',
    // Stub CSS/image imports
    '\\.svg$': '<rootDir>/src/__mocks__/fileMock.js',
  },
  testMatch: ['<rootDir>/src/__tests__/**/*.test.{ts,tsx}'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**',       // Next.js pages covered by E2E
  ],
};

module.exports = createJestConfig(customConfig);
