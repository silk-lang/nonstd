"""Use the Silk version manager locally, or an installed pinned silkc in CI."""
from pathlib import Path
import shutil

def compiler_command(operation):
    command = shutil.which('silk') or shutil.which('silkc')
    if not command:
        raise SystemExit('Install the repository-pinned Silk compiler or put scripts/install-silk output on PATH')
    result = [command, operation]
    if Path(command).stem == 'silkc' and operation != 'format':
        result += ['--stdlib', str(Path(command).resolve().parents[1] / 'lib/silk/stdlib')]
    return result
