export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        localStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        Set: "readonly",
        Map: "readonly",
        Promise: "readonly",
        URL: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        HTMLElement: "readonly",
        Event: "readonly",
        alert: "readonly",
        confirm: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        Chart: "readonly",
        self: "readonly",
        caches: "readonly",
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "off",
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-constant-condition": "warn",
    }
  },
  {
    files: ["sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        URL: "readonly",
        console: "readonly",
        Promise: "readonly",
      }
    }
  }
];
