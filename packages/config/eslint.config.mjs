import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint flat config for OneStop.
 * @param {{ nextAppDir?: string }} [options]
 */
export function createConfig(options = {}) {
  const { nextAppDir } = options;

  return tseslint.config(
    {
      ignores: [
        "**/node_modules/**",
        "**/.next/**",
        "**/dist/**",
        "**/coverage/**",
        "**/next-env.d.ts",
        "tests/fixtures/**",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        globals: { ...globals.node, ...globals.browser },
      },
      rules: {
        eqeqeq: ["error", "always"],
        "no-console": ["error", { allow: ["warn", "error"] }],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/consistent-type-imports": "error",
      },
    },
    ...(nextAppDir
      ? [
          {
            files: [`${nextAppDir}/**/*.{js,jsx,ts,tsx}`],
            plugins: { "@next/next": nextPlugin },
            settings: { next: { rootDir: nextAppDir } },
            rules: {
              ...nextPlugin.configs.recommended.rules,
              ...nextPlugin.configs["core-web-vitals"].rules,
            },
          },
        ]
      : []),
    {
      // CLI scripts legitimately print to stdout.
      files: ["**/scripts/**"],
      rules: { "no-console": "off" },
    },
    prettierConfig,
  );
}

export default createConfig();
