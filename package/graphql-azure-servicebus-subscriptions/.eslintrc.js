module.exports = {
  'extends': [
    "plugin:@typescript-eslint/recommended",
    "prettier/@typescript-eslint",
    "plugin:prettier/recommended",
  ],
  'parser': '@typescript-eslint/parser',
  'parserOptions': {
    'ecmaVersion': '2022',
    'sourceType' : "module"
  },
  'settings' : {},
  'plugins': [
    '@typescript-eslint',
  ],
  'rules': {
  },
};
