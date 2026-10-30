from dataclasses import dataclass, field
import re

@dataclass
class Token:
    kind: str
    text: str
    line: int = 0
    tags: list[str] = field(default_factory=list)

def tokenize(source: str) -> list[Token]:
    """Split source into words and symbols."""
    tokens = []
    for line_number, line in enumerate(source.splitlines(), start=1):
        for match in re.finditer(r"\w+|[^\s\w]", line):
            kind = "word" if match.group().isalnum() else "symbol"
            tokens.append(Token(kind, match.group(), line_number))
    return tokens

if __name__ == "__main__":
    print(f"{len(tokenize('a = b + 1'))} tokens", 0o17, 3.14j, None, True)
