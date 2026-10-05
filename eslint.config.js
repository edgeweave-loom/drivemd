import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-e2e",
    "coverage",
    "test-results",
    "playwright-report",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  noUnsanitized.configs.recommended,
  {
    // React's rules are for the app, not for the Node-side tests and tools.
    files: ["src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
  },
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-eval": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(JSXAttribute[name.name='dangerouslySetInnerHTML'], Property[key.name='dangerouslySetInnerHTML'], Property[key.value='dangerouslySetInnerHTML'], MemberExpression[property.name='dangerouslySetInnerHTML'])",
          message:
            "Raw HTML reaches the DOM unsanitized; render it through the sanitizing pipeline instead.",
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
]);
