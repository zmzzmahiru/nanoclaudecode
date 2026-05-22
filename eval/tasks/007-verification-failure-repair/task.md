Fix the slug formatting bug and rely on after-edit verification.

The final behavior should make `slugify("Hello, Nano Claude!")` return
`hello-nano-claude`.

If verification fails, inspect the failure and repair the implementation.
