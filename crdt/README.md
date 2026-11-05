# crdt

A collaborative document store with rich text. Every change is a
delta in a causal graph; a version is a frontier (the tips of the graph); replicas exchange deltas
and converge without a central authority deciding order.

| Package | What it is |
| --- | --- |
| `crdt/btree` (`crdt-btree`) | A persistent copy-on-write B+ tree with summaries and seeks. Versions share nodes. |
| `crdt/core` (`crdt-core`) | Delta ids and frontiers (`clock`), the causal graph (`graph`), plain text (`text`), rich text marks (`rich`), add-wins maps (`map`), documents and deltas (`doc`), the byte encoding (`codec`), and the `Store` service with a memory store and conformance suite (`store`). |
| `crdt/store-sqlite` (`crdt-store-sqlite`) | A `Store` in SQLite through `db/sqlite`. macOS and Linux. |
| `crdt/sync` (`crdt-sync`) | Sync in one exchange: the `Transport` service and `SyncServer` interface, `Client`, `MemoryServer`, `StoredServer`, an in-process `Loopback` with an offline switch, and a TCP transport (`tcp`). |
| `crdt/server` (`crdt-server`) | The sync server executable: TCP on 127.0.0.1, documents kept in SQLite. |
| `crdt/demo` (`crdt-demo`) | Two people editing one rich-text document through an in-process server, with an offline switch and a history bar. `demo/app` runs it in a window, `demo/tests` drives it through the real tree. |
| `crdt/showcase` (`crdt-showcase`) | Six scripted people writing one rich-text document at once, two of them offline for a while, drawn as six live copies with carets, author colors and the server's history. `showcase/record` renders it without a window and `showcase/scripts/record` encodes the video. |

## Text

Text is a sequence CRDT. Each insertion names its bytes by its delta id and offset, and records
the bytes it was typed between. Concurrent insertions at one place are ordered with the YATA rule
(as Yjs does), so runs typed by different people never interleave. Deletions leave tombstones.
Offsets are UTF-8 bytes.

An operation does not carry an offset plus the version it was made at: it carries the ids of its
neighbours, so a replica applies it without rebuilding an old version first.

## Rich text

Marks follow Peritext: a mark sets a key (bold, a link, a heading level) over a range whose ends
sit before or after named bytes, so the range keeps covering the same text while others edit
around it. An `Expand` choice says whether text typed at an edge joins the mark (bold grows at its
end, a link does not). On each byte the mark with the highest delta id wins for its key; removing
a style is a mark too. Block attributes are marks on a line break; an embed is U+FFFC with a mark
holding its data. `RichText.spans` gives the runs of equal attributes for a renderer.

## Documents

A `Document` holds rich texts and maps by object id. Local edits apply at once and gather in a
pending delta until `commit`, so a transaction is the edits between two commits. `apply` takes a
delta from another replica once its parents are here. `checkout(version)` rebuilds the document as
a replica that saw only that version's past would have it (by replay; snapshots are not
implemented yet).

## Persistence and sync

`Store` is a service: `save` and `load` work with any provider, `MemoryStore` and `SqliteStore`
are two, and `conformance()` is the suite a new one must pass.

A sync exchange is one request and one response. The client sends its tips, a few older ids at
log-spaced distances back, and the deltas it has not sent yet; the server applies them and answers
with what the client lacks. After a long time offline a client gets little more than it missed.
The wire is a `Transport` and the server a `SyncServer`, so a WebSocket transport or another
server can replace the TCP and in-memory ones.

## Running

```sh
silk test --manifest-path crdt/core/silk.toml --root src/tests.silk
silk test --manifest-path crdt/sync/silk.toml --root src/tests.silk
silk test --manifest-path crdt/demo/tests/silk.toml --root src/tests.silk
silk run --manifest-path crdt/server/silk.toml            # CRDT_SERVER_PORT, CRDT_SERVER_DB
silk run --manifest-path crdt/demo/app/silk.toml          # the demo in a window
```

## Not done yet

- Snapshots: checking out a version replays its whole past.
- Finding a byte by id is a linear scan of the fragments; an index would make remote edits on
  long texts faster.
- The server answers one request at a time and clients poll; there is no push or WebSocket.
- Lists and moves, a `replicate` derive for user types, and a background store writer.
- Windows is not tested: `crdt/sync`'s socket test needs a Silk release with
  silk-lang/silk#2769, and the SQLite store and the server are not set up for it yet.
