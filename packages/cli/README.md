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
  return Command.make("greet", "Say hello to someone")
    |> Command.withVersion("0.1.0")
    |> Command.option(Opt.named("name") |> Opt.describe("Who to greet") |> Opt.alias("n"))
    |> Command.option(Opt.named("times") |> Opt.describe("How many times"))
    |> Command.arg(Arg.named("files") |> Arg.describe("Files to mention"))
}

// In main: run Cli.fromHost(greet(), move defaults) gives Parsed.Run { value }, Parsed.Help,
// Parsed.Version, or Parsed.Failed { error }.
```

See [`examples/greet`](../../examples/greet/src/main.silk),
[`examples/git`](../../examples/git/src/main.silk) (subcommands), and
[`examples/serve`](../../examples/serve/src/main.silk) (choices, environment variables, grouped
flags) for complete programs.

## What it supports

- Field types choose the reader through `ArgValue`: `String`, the integer types, `bool` (a flag),
  `Option<T>` (present when given), and `List<T>` (every occurrence, or every remaining
  positional argument). Implement `FromArg` or `ArgValue` for your own types.
- `--name value`, `--name=value`, `-n value`, `-n5`, flags, grouped one-letter flags such as
  `-vq`, positional arguments, and `--`.
- Choices: `Opt.choice("json") |> Opt.choice("text")` (or `Arg.choice`) limits a value to
  those words, and the help text lists them.
- Environment fallbacks: `Opt.env("PORT")` reads `PORT` when the command line does not give
  `--port`. The command line wins over the environment, which wins over the defaults. A flag is
  set unless its variable is empty, `0`, or `false`. `Cli.fromHost` reads the variables, and
  `Cli.parseWith` takes them as a slice of `Variable` (handy in tests).
- Fields the description does not mention are options named after the field, in kebab-case
  (`nickName` is `--nick-name`).
- Defaults are the struct value you pass in. `Opt.required` and `Arg.required` make a value
  mandatory.
- `--help` and `-h`, and `--version` when the command has a version.
- Subcommands, nested to any depth: a field of type `Option<Sub>` added with
  `command |> Command.subcommand("field", subDescription)`. Give it `Option.some(defaults)`; after
  parsing only the chosen subcommand is present. `Parsed.Help { command }` names the subcommand
  path whose help was asked for, and `Cli.writeHelp<T>(spec, command)` prints it.
- Shell completions: `Completion.writeBash<T>(spec)` and `Completion.writeZsh<T>(spec)` write a
  script that completes subcommands, option names, and choices, and follows the subcommands
  already typed. `examples/git --completions bash` shows one way to offer it.
- Compile errors for a description that names a missing field, repeats a field, name, or alias, or
  for a field type without `ArgValue`.

## Not yet

- Fish completions, and completing file names for positional arguments.

## Known rough edges

- Field writes go through one unsafe helper in `parse.silk`, because `silk.reflect` has no mutable
  field projection yet ([silk#2347](https://github.com/silk-lang/silk/issues/2347)).
