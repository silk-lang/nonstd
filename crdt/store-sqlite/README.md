# crdt/store-sqlite

A `Store` for `crdt-core` kept in SQLite, through `db/sqlite`. One table holds every delta, keyed
by document and delta id, with its place in the order saved.

```silk
import core.store { load, save, Store }
import store_sqlite.sqlite_store { SqliteStore }

let mut store = run SqliteStore.open("notes.db")
let saved = run save(&document, 1, 0) |> Effect.provideMut<Store>(&mut store)
let again = run load(1, actor) |> Effect.provideMut<Store>(&mut store)
```

Runs on macOS and Linux, like `db/sqlite`. Tests run the `crdt-core` store conformance suite:

```sh
silk test --manifest-path crdt/store-sqlite/silk.toml --root src/tests.silk
```
