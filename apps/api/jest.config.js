/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  rootDir: "src",
  testEnvironment: "node",
  testRegex: String.raw`.*\.spec\.ts$`,
  moduleFileExtensions: ["js", "json", "ts"],
  // Property-based suites do real gzip/tar + filesystem I/O across many
  // iterations; give them headroom and avoid parallel temp-dir contention.
  testTimeout: 120000,
  maxWorkers: 1,
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        // The source uses ESM-style ".js" import specifiers; compile to CJS for Jest.
        // isolatedModules => transpile-only (no full type-check), so the suite runs
        // without @types/jest being installed in the workspace.
        isolatedModules: true,
        tsconfig: {
          module: "commonjs",
          target: "ES2022",
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          strictPropertyInitialization: false,
          skipLibCheck: true,
        },
      },
    ],
  },
  // Source imports sibling modules with explicit ".js" extensions (ESM style).
  // Strip the extension so ts-jest resolves the ".ts" source under CommonJS.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
