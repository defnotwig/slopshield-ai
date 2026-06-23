/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  rootDir: "src",
  testEnvironment: "node",
  testRegex: String.raw`.*\.spec\.ts$`,
  moduleFileExtensions: ["js", "json", "ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        // The source uses ESM-style ".js" import specifiers; compile to CJS for Jest.
        // isolatedModules => transpile-only (no full type-check) so the suite runs fast.
        isolatedModules: true,
        tsconfig: {
          module: "commonjs",
          target: "ES2022",
          esModuleInterop: true,
          strict: true,
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
