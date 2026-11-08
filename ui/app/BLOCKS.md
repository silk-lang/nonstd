# Block composition

Blocks split a UI feature into a public contract, an implementation, and a model. A parent
knows the child's contract and owns its model. Construction supplies the implementation.
Local messages, parent requests, outgoing notifications, and commands have separate types.

This is the Silk adaptation of the [Foldkit Blocks preview](https://github.com/foldkit/foldkit/pull/1655).
Silk interfaces, ownership, exhaustive matches, and effect services carry the contracts that
Foldkit expresses through schemas and Effect Layers.

The [composed counters example](examples/src/blocks.silk) is a complete library example. Its
[executable tests](tests/src/blocks.silk) cover construction, parent requests, command completion,
real tree input, and child subscriptions. Run them from the repository root:

```sh
silk test --manifest-path ui/app/tests/silk.toml --root src/blocks.silk
```

On macOS, set `SDKROOT` to the installed macOS SDK path when linking these tests. They use
native math functions from the font renderer. The compiler requires Clang 22 or newer.

## Declare the contract

`Block<S, M, I, O, C, A>` fixes six types: model, local message, parent input, outgoing message,
command, and initialization arguments. A public type alias names the complete contract. The
example declares `CounterBlock` once and constrains its generic parent implementation to it.
A different child implementation can satisfy the same contract without changing parent logic.

The implementation provides `init`, `update`, `receive`, `view`, and optional `subscriptions`.
`init` returns the model and records initial outputs. `update` handles local messages and command
results. `receive` handles the distinct input union: for example, `RequestedClear` or
`InformedOfValue`. Silk checks exhaustive matches and rejects a local message passed to `receive`.
These names are conventions; Silk does not generate methods from union variant names.

Keep application state in the model. The implementation contains dependencies and shared
configuration. A view reads the model and runs both during rendering and event delivery.

## Construct implementations with Layers

`Layer<B, E, R>` constructs implementation `B`, with error type `E` and required services `R`.
Its `build` method is an ordinary Silk effect. `Effect.provide` and `Effect.provideMut` select
providers at the application boundary or in a test. A parent Layer builds child implementations
and installs their bindings. Construction does not initialize models.

`CounterLayer` reads the `CounterSettings` service. `CountersLayer` builds that child implementation
and injects its binding into the parent. Tests can supply different settings or a completely
different implementation of `CounterBlock`.

`block.build` constructs a Layer and initializes an `Instance`. `Instance.make` accepts an
already constructed implementation. Both retain initialization commands and outgoing messages.
Owned dependencies are dropped with the implementation. A construction error propagates through
the effect without producing an initialized instance. Resource acquisition that requires an
explicit effectful release must stay within the host's corresponding effect scope.

`Instance.intoRuntime` creates the ordinary UI runtime and transfers pending commands. Start it
against a `UiTree`, then call `drain` to perform initialization commands before accepting input.
Use the existing window host and headless harness for the resulting runtime. Commands implement
`Perform` and keep their typed service requirements. Root outgoing messages remain available in
`runtime.model.pending.outgoing`.

## Bind children to parent-owned models

A `Binding` owns the implementation for one child relationship. A stable `id` distinguishes it
from sibling relationships. It does not own child models.

| Storage | Operations |
| --- | --- |
| Required field | `create`, then `message` or `receive` on the stored model |
| Optional field | `initIfMissing`; match the option before delivery |
| Keyed children | `append`, `messageIn`, `receiveIn`, and `Children.remove` |
| Custom map or union | Select the model in the parent, then use `message` or `receive` |

Required and optional initialization write all outputs into a `BlockContext`. After placement,
use `forward` to map commands into the parent's command type and fold outgoing messages. Commands
are transferred first, followed by outgoing messages, in insertion order within each channel.
The complete parent transition finishes before the runtime executes any commands.

`append` performs keyed initialization and placement together, and forwards initial commands and
outgoing messages through the same mapping used for later transitions. Duplicate keys do not
initialize a second model or produce outputs. Forwarding callbacks can accumulate changes in
local values; apply those values to the parent after the child storage borrow ends.

A keyed child has an `Address` with binding identity, business key, and occurrence generation.
`Routed<T>` preserves this address through command execution. Delivery checks all three fields.
Removing and recreating a key cannot redirect an old command result into the replacement.
Removal does not cancel already running effects; it rejects their late messages.

Keep a `Children` collection alive for the lifetime of its parent: replacing the whole collection
resets its generation sequence. Each collection belongs to one binding. For an optional child
that needs the same protection against late results, use a one-entry `Children` collection.
The parent chooses when a child is active by including its view and subscriptions.

## Compose views and subscriptions

`Binding.view` uses `Ui.map` to translate child messages into the parent envelope. Mapping adds
no nodes and stores no callbacks. It preserves the render state, keyed matching, event depth,
bubbling, stop propagation, lazy regions, overlays, and virtual-list state. Mappings can nest.

Give each child a containing node. In a keyed collection, use the occurrence generation for
that node's view key. A surviving child keeps its UI identity when moved; a replacement gets
fresh retained UI state. Place different child relationships under separate parent containers.
Anchor, overlay, and virtual-list keys belong to the complete view and must remain unique.

`Binding.subscriptions` maps both messages and subscription keys. Supply a stable key mapping
that is unique across all active subscriptions in the application. The counter example has one
subscription per occurrence and uses the generation as its key. A child with multiple
subscriptions needs a separate key for each. Omit removed or inactive children when collecting
subscriptions, and the existing runtime stops their timers.

## Compose updates

The `update` module operates on a borrowed dispatched message, a mutable model, and one shared
`BlockContext`. Messages can contain owned data without requiring `Copy`.

- `compose` runs two steps in order. The second sees the first step's model changes.
- `each` applies a step to a sequence of operation values in order.
- `on` and `except` select steps by message predicates.
- `observe` captures an owned model projection before a step and gives that projection to an
  after-update callback. The example records the prior count this way.

Every step retains the accumulated commands and outgoing messages. For undo history, capture an
independent document value and exclude undo/redo messages from the history observer. Silk models
can contain affine collections, so the library does not silently clone a complete model.

## Test Blocks and composed applications

`Story.fromLayer` uses the same construction path as production. A Story records initialization
commands, accepts local `message` and parent `receive` calls, and exposes owned observations through
`model`. Copy selected values or explicitly clone owned fields when taking an observation.

`messageIn` accepts a child event and a typed envelope-building function. Nest parent constructors
for deeper paths and include the selected occurrence address. Delivery runs the real parent
update, binding checks, and outgoing-message folds. It does not bypass the parent to mutate a
child directly.

`expectExactInOrder` checks the entire pending command queue with an explicit comparator and does
not consume it. `resolve` removes the oldest command and feeds its simulated result back through
the real update. Alternatively, take commands and run their real effects with test service
providers. `finish` rejects unhandled commands and returns the final instance. Outgoing messages
can be taken and asserted separately.

For scene tests, convert the instance to a runtime and use `harness.click`, `press`, `typeText`,
and the other real-tree drivers. The tests exercise this path, including mapped child input and
independent child timers. No additional scene execution engine is needed.
