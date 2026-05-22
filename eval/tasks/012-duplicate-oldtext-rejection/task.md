Update only the second item in `items.txt` from `status: pending` to
`status: done`.

First call `edit_file` on `items.txt` with oldText exactly `status: pending` so
the duplicate oldText rejection is recorded. Then make a targeted safe edit for
only the second item.
