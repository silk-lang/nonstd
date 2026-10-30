#!/usr/bin/env python3
"""Compare parse+record costs of identical plain/gzip/zlib SVG source bytes."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import platform
import statistics
import subprocess
import tempfile
import zlib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--silk', type=Path, required=True)
    parser.add_argument('--rust', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--callgrind', action='store_true')
    args = parser.parse_args()
    source = args.input.read_bytes()
    data = {'plain':source, 'gzip':gzip.compress(source,mtime=0), 'zlib':zlib.compress(source)}
    report = {'platform':platform.platform(),'input_sha256':hashlib.sha256(source).hexdigest(),
              'iterations':5,'warmup':1,'samples':3,'stage':'parse+record','rows':[],'binaries':{}}
    with tempfile.TemporaryDirectory(prefix='nonstd-compressed-bench-') as temporary:
        directory = Path(temporary)
        for engine, executable in [('silk',args.silk.resolve()),('resvg',args.rust.resolve())]:
            report['binaries'][engine]={'path':str(executable),'sha256':hashlib.sha256(executable.read_bytes()).hexdigest()}
            original_checksum = None
            for encoding,payload in data.items():
                path = directory/f'{encoding}.svg'
                path.write_bytes(payload)
                row = {'engine':engine,'encoding':encoding,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}
                # usvg's file parser supports gzip, not a bare zlib wrapper.
                # Its unsupported result is recorded, never counted as a timing sample.
                probe = subprocess.run([str(executable),'parse',str(path),'5','1'],capture_output=True,text=True,timeout=120)
                if probe.returncode:
                    if engine != 'resvg' or encoding != 'zlib' or probe.returncode != 1:
                        raise RuntimeError(probe.stderr)
                    row.update(supported=False,stderr=probe.stderr.strip(),exit_code=probe.returncode)
                    report['rows'].append(row)
                    continue
                samples = [json.loads(probe.stdout)]
                for _ in range(2):
                    result = subprocess.run([str(executable),'parse',str(path),'5','1'],capture_output=True,text=True,check=True,timeout=120)
                    samples.append(json.loads(result.stdout))
                checksum = samples[0]['checksum']
                if encoding == 'plain': original_checksum = checksum
                for sample in samples:
                    if sample['iterations'] != 5 or sample['warmup'] != 1 or sample['elapsed_ns'] <= 0 or sample['checksum'] != original_checksum or int(sample['consumed']) != int(checksum)*6 % 2**64:
                        raise ValueError('invalid timing or compressed/plain output mismatch')
                row.update(supported=True,checksum=checksum,median_ms=statistics.median(s['elapsed_ns']/5/1e6 for s in samples),samples=samples)
                if args.callgrind and engine == 'silk':
                    counts = directory/'callgrind.out'
                    subprocess.run(['valgrind','--tool=callgrind',f'--callgrind-out-file={counts}',str(executable),'parse',str(path),'1','0'],capture_output=True,text=True,check=True,timeout=300)
                    row['process_ir']=int(next(line.split(':',1)[1] for line in counts.read_text().splitlines() if line.startswith('summary:')))
                report['rows'].append(row)
                print(f'{engine}/{encoding}: {row["median_ms"]:.4f} ms/parse+record',flush=True)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n')

if __name__ == '__main__':
    main()
