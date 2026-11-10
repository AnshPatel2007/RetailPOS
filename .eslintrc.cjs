module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-hooks'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  overrides: [{
    // Guardrails for the store app: one date format in the store's time zone, no browser pop-ups.
    files: ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx'],
    excludedFiles: ['frontend/src/lib/utils.ts', 'frontend/src/**/*.test.ts', 'frontend/src/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]",
          message: 'Show dates with formatDate / formatDateTime / formatTime from lib/utils (pass the store time zone).' },
        { selector: "CallExpression[callee.object.name='window'][callee.property.name=/^(alert|confirm|prompt)$/]",
          message: 'Use ConfirmDialog / useConfirm or a toast, never a browser pop-up.' },
      ],
    },
  }],
}
