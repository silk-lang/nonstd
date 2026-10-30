#!/usr/bin/env bash
set -euo pipefail

name="${1:-world}"
count=$(ls -1 | wc -l)
if [[ "$count" -gt 3 ]]; then
  echo "hello, $name ($count files)" >&2
fi
for file in *.txt; do
  cat <<EOF > "${file%.txt}.md"
# $file
EOF
done
