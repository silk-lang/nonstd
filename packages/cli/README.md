# cli

Describe a command with a struct and a static description. The description is checked against the
struct during compilation, and the loop over the fields is expanded during compilation too, so the
parser that runs only compares arguments with option names. Inspired by Effect's
[`cli`](https://github.com/Effect-TS/effect/tree/main/packages/effect/src/cli) package.

```silk
import cli.lib { Arg, Cli, Command, Opt, Parsed }

struct Greet {
  pub name: String,
  pub times: u32,
  pub loud: bool,
  pub files: List<String>,
}

static fn greet() -> Command {
  let mut command = Command.make("greet", "Say hello to someone")
  command = Command.withVersion(command, "0.1.0")
  command = Command.option(command, Opt.alias(Opt.describe(Opt.named("name"), "Who to greet"), "n"))
  command = Command.option(command, Opt.describe(Opt.named("times"), "How many times"))
  command = Command.arg(command, Arg.describe(Arg.named("files"), "Files to mention"))
  return command
}

// In main: run Cli.fromHost(greet(), move defaults) gives Parsed.Run { value }, Parsed.Help,
// Parsed.Version, or Parsed.Failed { error }.
```

See [`examples/greet`](../../examples/greet/src/main.silk) for a complete program.

## What it supports

- Field types choose the reader through `ArgValue`: `String`, the integer types, `bool` (a flag),
  `Option<T>` (present when given), and `List<T>` (every occurrence, or every remaining
  positional argument). Implement `FromArg` or `ArgValue` for your own types.
- `--name value`, `--name=value`, `-n value`, flags, positional arguments, and `--`.
- Fields the description does not mention are options named after the field, in kebab-case
  (`nickName` is `--nick-name`).
- Defaults are the struct value you pass in. `Opt.required` and `Arg.required` make a value
  mandatory.
- `--help` and `-h`, and `--version` when the command has a version.
- Compile errors for a description that names a missing field, repeats a field, name, or alias, or
  for a field type without `ArgValue`.

## Not yet

- Subcommands (planned as `Option<Sub>` fields).
- Environment variable fallbacks, choices, and shell completions.
- Grouped short flags such as `-abc`.

## Known rough edges

- Builders are nested calls, because `|>` and method calls do not work in a `static fn` yet.
- Field writes go through one unsafe helper in `parse.silk`, because `silk.reflect` has no mutable
  field projection yet.
