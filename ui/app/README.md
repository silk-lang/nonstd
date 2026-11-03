# ui-app

A Silk UI framework in the Elm style, on top of [ui-tree](../tree): a model, messages, a pure
`view`, an `update`, and commands and subscriptions as plain data. The view is a function the
runtime calls again; it diffs the new description against the last one and sends the retained
tree the fewest `Mutation`s it can. It uses only the tree's public `Mutation` and `Event` API, so
anything this package does, another client of the tree can do too.

Packages:

- `ui/app` (`ui-app`): the builder (`ui.silk`), the diff (`diff.silk`), the app contract
  (`app.silk`), the runtime (`runtime.silk`), headless driving for tests (`harness.silk`) and
  loop helpers (`seq.silk`).
- `ui/app/window` (`ui-app-window`): `runWindow`, the loop that runs an app in a native window
  through [platform/window](../../platform/window) and [ui_renderer](../../graphics/ui_renderer).
  `runWindowWith` also serves an [inspector](../inspect/server) (debug builds with
  `SILK_UI_INSPECT` set), so ui-inspect-cli, ui-inspect-mcp and the
  [devtools window](../inspect/devtools) can look at the app.
- `ui/app/examples`: a counter and a todo list. `ui/app/demo` runs the todo list in a window.
- `ui/app/tests`: unit tests and the golden scenes.

## An app

```silk
pub struct Counter { pub count: i64 }
pub union Message { Increment, Decrement }

impl App<Message, NoCommand> for Counter {
  fn view(self: &Self, ui: &mut Ui<Message>) -> () {
    ui.row(
      |ui| {
        ui.gap(8.0)
        ui.button("-", || Message.Decrement)
        ui.box(|ui| { ui.testId("count"); ui.number(self.count) })
        ui.button("+", || Message.Increment)
      },
    )
  }

  fn update(self: &mut Self, message: Message, cx: &mut Context<NoCommand>) -> () {
    match move message {
      Message.Increment => { self.count = self.count + 1 }
      Message.Decrement => { self.count = self.count - 1 }
    }
  }
}

let mut runtime = Runtime<Counter, Message, NoCommand>.make(Counter { count: 0 })
run runtime.start(&mut tree, 0.0)            // creates the root and the first render
run pump(&mut runtime, &mut tree)            // after each tree.dispatch: events to messages
run tick(&mut runtime, &mut tree, now, true) // timers and frames due at `now`
```

`App<M, C>` has `view`, `update` and `subscriptions` (empty by default). The command type
implements `Perform<M, E, ? R>`: `perform` is the only effectful code in an app, and its
failures `E` and requirements `R` (a store, the network, a clock) are provided once where the app
runs, so a test swaps them. `examples/src/todo.silk` saves through a `Store` service this way,
and the tests give it a memory store.

## Views

The builder opens nodes with a body: `box`, `row`, `column`, `node(kind, body)`, `input`,
`canvas`, `pressable`, and leaves with `text`, `number`, `image`, `icon` and `button`. Inside a
body, calls apply to the open node: `style` (and `hover`, `active`, `focused`, `focusVisible`
for the state variants), shorthands such as `padding`, `gap`, `background`, `color`, `fontSize`,
`width`, `height` and `grow`, the attributes `accessRole`, `label`, `testId`, `tabIndex`,
`cursor`, `disabled`, `focusTrap`, and handlers.

**Handlers are never stored.** `onClick(|| Message.Increment)` records only that the node
listens for clicks. When the tree reports an event, the runtime runs `view` again in dispatch
mode: it enters only the nodes on the event's path and calls the handlers there, in bubbling
order from the target up. `on(kind, handler)` takes a `fn(&Event) -> Reply<M>`, where `Reply`
is `Emit`, `EmitAndStop`, `Stop` or `Pass`. Enter, leave, focus, blur and scroll go to the
target only. So a handler sees the model as it is when the event arrives, and nothing captured
can go stale.

**Lists** use `ui.each(items, key, body)` (and `ui.enumerate` with the index): the first node
the body opens for an item takes its key, so the diff keeps the node (and its focus, scroll and
hover state) when the item moves. Without keys, children match by their order among unkeyed
siblings and their kind. `ui.key(value)` keys the next node by hand.

`seq` has the same loops for plain data: `forEach`, `enumerate`, `count`, and `map` and
`filter`, which build a `List` and so need an allocator. These are functions over slices, not a
`Stream` type: when std settles on one, `each` can take it without the views changing.

**`lazy(hash, body)`** reuses the last render's region when `hash` (of everything `body` reads)
is unchanged, as Elm's `Html.lazy`; the diff skips it.

## The diff

Nodes are matched while the view builds: same parent, then the same key (or unkeyed ordinal) and
the same kind. A match keeps its tree id; anything else is created, and old nodes left over are
destroyed. Within a parent, the nodes that keep their relative order are found with a longest
increasing subsequence, and only the others are moved, so rotating a list of five is one
`InsertBefore` and reversing it is four. Styles go out as the properties that changed
(`ClearStyle` first when one was removed), and text, attributes, listeners, sources and canvas
commands only when they differ. Tree ids grow and are never reused. Id 1 is the runtime's root,
a column filling the viewport.

`runtime.stats` counts renders, dispatches, messages, commands, mutations, nodes and reused
nodes, for tests and for the inspection phases.

## Subscriptions

`subscriptions(subs)` returns what the model wants now, each with a key: `every(key, seconds,
handler)`, `animationFrame`, `keyBinding(key, name, modifiers, handler)` (wherever focus is,
unless a view handler stops the key first) and `resize`. The runtime asks after every update,
starts the new keys and stops the missing ones. Handlers are delivered the way view handlers
are: by asking again and calling the one that matches. `runtime.nextDeadline()` tells a loop how
long it can wait.

## Testing and driving

`harness` drives an app without a window through the tree's real input path: `click(runtime,
tree, viewport, "Add")` finds a node by test id, label or text and clicks its center;
`press(..., "n", MOD_CONTROL)` presses a key; `snapshot` returns the `describe` text. The tests
check counts and stats with these, and `ui/app/tests` renders golden scenes (`describe` text and
PNG) for the counter and the todo list. `ui/app/demo/scripts/demo check` runs the todo list in a
real window on X11 and Wayland, clicks Add and compares a frame.

## Limits

- Commands run in order, synchronously, right after the update that made them, and their
  message is handled next. Running them on fibers needs a way to hand a result back to the loop
  (a channel or poll) that std does not have yet. There is no cancellation by key.
- There is no `ui.map` for embedding a child app with its own message type, and no custom
  subscription kind.
- Text editing in `input` comes with ui-tree T5; `onInput` is wired but nothing fires it yet.
- Style and attribute calls a `lazy` body makes on its parent are not kept when the region is
  reused; open a node inside `lazy` instead.
- Two items with the same key under one parent: the second gets a new node each render.
- Running out of memory traps.
- Compiler limits shape the API (Silk dev.45): effect lambdas cannot nest, and an effect op of a
  generic interface cannot take an owned value of the type parameter. So `view` and `update` are
  plain functions that allocate through `ui.alloc` and `cx.alloc`, and `perform` takes
  `&Self`. Lifting either limit would let `view` and `update` be effect functions and
  `perform` take the command by value.
