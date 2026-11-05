# db/sqlite

SQLite for Silk. The package compiles SQLite 3.54.1 from its amalgamation (fetched from sqlite.org
and pinned by SHA-256 in `silk.toml`) into every program that depends on it, so nothing has to be
installed on the machine.

```silk
import sqlite { Connection, SqliteError, TransactionKind }

effect fn demo() -> () ! SqliteError | OutOfMemoryError ? &mut Allocator {
  let db = run Connection.open("notes.db")
  run db.execute("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body BLOB)")

  let mut transaction = run db.begin(TransactionKind.Immediate)
  let mut insert = run db.prepare("INSERT INTO notes (body) VALUES (?)")
  run insert.bindBlob(1, b"hello")
  drop run insert.execute()
  run transaction.commit()

  let mut query = run db.prepare("SELECT id, body FROM notes WHERE id > ?")
  run query.bindInt(1, 0)
  while run query.step() {
    let id = query.columnInt(0)
    let body = query.columnBlob(1) // borrowed until the next step
  }
}
```

## API

- `Connection.open(path)`, `openWith(path, OpenMode)` and `openMemory()`. Dropping a connection
  closes it. Statements prepared on it stay valid after that (SQLite closes the database once the
  last statement is gone), so a struct can keep a connection and its prepared statements together.
- `Connection.execute(sql)` runs a script of statements that return no rows (schemas, migrations,
  pragmas). `Connection.prepare(sql)` compiles exactly one statement, prepared for reuse.
- `Statement`: `bindInt`, `bindFloat`, `bindText`, `bindBlob`, `bindNull`, `bindZeroBlob`,
  `bindValue`, `parameterIndex(":name")`, `step`, `execute` (run to the end and reset, returns the
  changed rows), `reset`, `clearBindings`, and the column readers `columnInt`, `columnFloat`,
  `columnText`, `columnTextBytes`, `columnBlob`, `columnValue`, `columnType`, `columnIsNull` and
  `columnName`. Parameters count from 1, columns from 0. Text and blob reads borrow the statement
  and need no copy.
- `Connection.begin(TransactionKind)` returns a `Transaction` guard: `commit()` or `rollback()`,
  and dropping it uncommitted rolls back, so a failure in the middle leaves the database unchanged.
- `SqliteError` has the extended result `code` (such as 2067 for `SQLITE_CONSTRAINT_UNIQUE`),
  SQLite's `message`, and `primary()`, `isBusy()` and `isConstraint()`. The primary codes are
  constants (`ERROR`, `BUSY`, `CONSTRAINT`, ...).
- `changes`, `totalChanges`, `lastInsertRowId`, `isAutocommit`, `busyTimeout`, `version` and
  `versionNumber`.

The `sys` module has the raw C functions for anything the safe API does not cover yet.

## Build options

SQLite is built thread-safe (`SQLITE_THREADSAFE=1`) with FTS5, R*Tree and the math functions, plus
the JSON functions that are always on. Double-quoted string literals are off (`SQLITE_DQS=0`), as
SQLite recommends, so `"name"` is always an identifier. Loadable extensions and shared cache are
left out.

## Platforms

macOS, Linux and Windows. On Windows, run `python scripts/prepare-windows` once from an x64 Visual
Studio developer shell: SQLite needs the Windows SDK headers, which Silk does not pass to Clang, so
that script builds SQLite and the shim into a library (`db/sqlite/scripts/windows`) and points the
`sqlite` archive at it. The browser is not supported.

## Tests

```sh
silk test --manifest-path db/sqlite/silk.toml --root src/tests.silk
```

To work offline, point the `sqlite` archive at a directory holding `sqlite3.c` and `sqlite3.h` in
`$SILK_HOME/native-overrides.toml`:

```toml
[native.override.sqlite]
path = "/path/to/sqlite-amalgamation"
```
