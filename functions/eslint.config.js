export default [
  {
    ignores: ['node_modules'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'max-len': ['error', {code: 80}],
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'no-trailing-spaces': 'error',
      'object-curly-spacing': ['error', 'never'],
    }
  }
];
