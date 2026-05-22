Add a `--json` output mode to this tiny CLI.

Required changes:

- update `cli.js` so `node cli.js --name Ada --json` prints `{"message":"Hello, Ada"}`
- update `README.md` to document `--json`
- update `test.js` to include a `--json` test

Keep the existing plain text behavior working.
