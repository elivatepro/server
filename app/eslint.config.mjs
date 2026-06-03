import neostandard, { plugins } from 'neostandard'

export default [
  {
    ignores: ['dist/**', 'src/v1/templates/**']
  },
  ...neostandard({ ts: true }),
  {
    plugins: {
      '@typescript-eslint': plugins['typescript-eslint'].plugin
    },
    rules: {
      'no-new': 'off',
      'no-prototype-builtins': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off'
    }
  }
]
