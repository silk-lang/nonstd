# cli

Describe a command with a struct, or with a union of subcommands, and a static description. The
description is checked against the type during compilation: each field name in the description is
checked where it is written, so `Command.option("tmes", ...)` stops compilation at `"tmes"`, and
the editor links the name to the field. The loops over the fields and variants are expanded during
compilation too, so the parser that runs only compares arguments with option names. The parser
builds the value after reading the whole command line, so there is no defaults value to fill in
first. Inspired by Effect's
[`cli`](https://github.com/Effect-TS/effect/tree/main/packages/effect/src/cli) package.

```silk
import cli.lib { Cli, Command, CommandLine, Opt }

struct Greet {
  pub name: String,
  pub times: u32,
  pub loud: bool,
  pub files: List<String>,
}

impl CommandLine for Greet {
  static fn command() -> Command<Greet> {
    return Command<Greet>.make("greet", "Say hello to someone")
      |> Command.withVersion("0.1.0")
      |> Command.option("name", Opt.about("Who to greet") |> Opt.short("n") |> Opt.default("world"))
      |> Command.option("times", Opt.about("How many times") |> Opt.default("1"))
      |> Command.arg("files", Opt.about("Files to mention"))
  }
}

// In main: run Cli.read<Greet>() gives Result.Success { value }, or Result.Failure { error: code }
// after it printed the help, the version, or an error. Cli.parse<Greet>(arguments) and
// Cli.fromHost<Greet>() give Parsed.Run, Parsed.Help, Parsed.Version, or Parsed.Failed instead.
```

Subcommands are a union whose variants are the commands, so running one is a single `match`:

```silk
struct Git {
  pub quiet: bool,
  pub command: GitCommand,
}

union GitCommand {
  Clone { pub url: String, pub depth: Option<u32> },
  Remote { pub verbose: bool, pub action: RemoteAction },
}

union RemoteAction {
  List,
  Add { pub name: String, pub url: String },
}

impl CommandLine for Git {
  static fn command() -> Command<Git> {
    return Command<Git>.make("git", "A tiny git")
      |> Command.option("quiet", Opt.about("Say less") |> Opt.short("q"))
      |> Command.subcommand("command")
  }
}

impl CommandLine for GitCommand {
  static fn command() -> Command<GitCommand> {
    return Command<GitCommand>.make("", "")
      |> Command.variant("Clone", "Copy a repository")
      |> Command.arg("url", Opt.required(Opt.plain()))
      |> Command.subcommand("action")
  }
}

impl CommandLine for RemoteAction {}
```

See [`examples/greet`](../../examples/greet/src/main.silk),
[`examples/git`](../../examples/git/src/main.silk) (subcommands and completions), and
[`examples/serve`](../../examples/serve/src/main.silk) (choices, checks, environment variables,
grouped flags) for complete programs.

## What it supports

- A type gets a parser through `CommandLine`. `impl CommandLine for T {}` takes the default
  description: every field is an option named after its label in kebab case (`nickName` is
  `--nick-name`), and every variant is a subcommand named the same way.
- Field types choose the reader through `ArgValue`: `String`, the integer types, `bool` (a flag),
  `Option<T>` (present when given), and `List<T>` (every occurrence, or every remaining
  positional argument). Implement `FromArg` or `ArgValue` for your own types.
- `--name value`, `--name=value`, `-n value`, `-n5`, flags, grouped one-letter flags such as
  `-vq`, positional arguments, and `--`.
- `Opt.about("help")` or `Opt.plain()` starts the description of a field; `Opt.short`, `Opt.long`,
  `Opt.required`, `Opt.choice`, `Opt.env`, `Opt.default`, and `Opt.check` add to it.
  `Command.option` reads the field as a named option, `Command.arg` as a positional argument, and
  `Command.subcommand` as a subcommand. A field whose description gives no help text shows the
  first line of its `///` comment instead. For a union, these name the fields of any of its variants,
  and `Command.variant` gives a variant its help text.
- A field the command line does not give takes its `Opt.env` variable, then its `Opt.default`,
  then the empty value of its type (`ArgValue.initial`: empty text, zero, `false`, `none`, or an
  empty list). `Opt.required` makes a value mandatory instead.
- Choices: `Opt.choice("json") |> Opt.choice("text")` limits a value to those words, and the help
  text lists them.
- Checks: `Opt.check<u16>(nonzero)` takes an ordinary `fn(&u16) -> bool` that a value must pass,
  or the command line is refused with an invalid value. The parser calls it directly, as if the
  check were written by hand.
- Environment fallbacks: `Opt.env("PORT")` reads `PORT` when the command line does not give
  `--port`. A flag is set unless its variable is empty, `0`, or `false`. `Cli.fromHost` reads the
  variables, and `Cli.parseWith` takes them as a slice of `Variable` (handy in tests).
- `--help` and `-h`, and `--version` when the command has a version. `Parsed.Help { command }`
  names the subcommand path whose help was asked for, such as `remote.add`, and
  `Cli.writeHelp<T>(command)` prints it.
- Subcommands nested to any depth, and a root that is itself a union.
- Shell completions: `Completion.writeBash<T>()`, `writeZsh`, and `writeFish` write a script that
  completes subcommands, option names, and choices, follows the subcommands already typed, and
  completes file names where a command takes positional arguments without choices.
  `examples/git completions bash` shows one way to offer it.
- Compile errors for a description that names a missing field or variant (at the name), repeats a
  field, name, or alias, or for a field type without `ArgValue`.

## Known rough edges

- A subcommand is required; an optional one (`Option<U>`) is not supported yet.
