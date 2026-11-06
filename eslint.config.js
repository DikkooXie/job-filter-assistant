import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/vendor/**', 'release/**', '**/*.min.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, chrome: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // shadcn 组件还是 JS 源码，类型声明只能用 any 兜住；这些声明本身不是业务代码。
    files: ['src/components/ui/*.d.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
