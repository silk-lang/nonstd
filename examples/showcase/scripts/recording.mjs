import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build, root, run } from '../../../scripts/internal.mjs';

// Match Python's round(), including half-way frame and still timestamps.
function roundEven(value) {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2 === 0 ? 0 : 1) : Math.round(value);
}

function completion(child) {
  return new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function succeeded(result, name) {
  if (result.error) throw result.error;
  if (result.code !== 0) throw new Error(`${name}: exit status ${result.code ?? result.signal}`);
}

export async function record({ packagePath, basename, seconds, stills }) {
  const { values } = parseArgs({ options: {
    out: { type: 'string', default: `build/${packagePath.split('/').at(-1)}` },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '720' },
    scale: { type: 'string', default: '1.5' },
    fps: { type: 'string', default: '30' },
    seconds: { type: 'string', default: String(seconds) },
    stills: { type: 'string', default: stills },
    'gif-width': { type: 'string', default: '600' },
    'frames-only': { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  } });
  if (values.help) {
    console.log(`Usage: ${packagePath}/scripts/record [options]
  --out build/${packagePath.split('/').at(-1)}  Output directory (relative to repository root)
  --width 1280 --height 720 --scale 1.5 --fps 30
  --seconds ${seconds} --stills ${stills} --gif-width 600
  --frames-only    Render and count frames without ffmpeg or output media
  --debug          Build without --release
Writes ${basename}.mp4 (H.264), ${basename}.gif and ${basename}-<seconds>s.png.
Requires Node.js and Silk; media encoding also requires ffmpeg. No Python or Pillow.`);
    return;
  }
  const number = (name, integer = false) => {
    const value = Number(values[name]);
    if (!values[name].trim() || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
      throw new Error(`--${name} requires ${integer ? 'an integer' : 'a number'}`);
    }
    return value;
  };
  const logicalWidth = number('width', true);
  const logicalHeight = number('height', true);
  const scale = number('scale');
  const fps = number('fps', true);
  const frames = roundEven(number('seconds') * fps);
  const gifWidth = number('gif-width', true);
  const width = Math.trunc(logicalWidth * scale + 0.5);
  const height = Math.trunc(logicalHeight * scale + 0.5);
  const size = width * height * 4;
  if (logicalWidth <= 0 || logicalHeight <= 0 || scale <= 0 || fps <= 0 || frames < 0 || width <= 0 || height <= 0) {
    throw new Error('Dimensions, scale and fps must be positive; duration must be nonnegative');
  }
  const selected = new Map();
  for (const timestamp of values.stills.split(',').filter(Boolean)) {
    const time = Number(timestamp);
    if (!timestamp.trim() || !Number.isFinite(time)) throw new Error(`Invalid still timestamp: ${timestamp}`);
    selected.set(roundEven(time * fps), timestamp);
  }
  const program = build(resolve(root, packagePath, 'record'), { release: !values.debug });
  const out = resolve(root, values.out);
  mkdirSync(out, { recursive: true });
  const video = resolve(out, `${basename}.mp4`);
  const rawInput = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-'];
  const frame = Buffer.allocUnsafe(size);
  const recorder = spawn(program, [logicalWidth, logicalHeight, scale, fps, frames].map(String), {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const recorded = completion(recorder);
  const encoder = values['frames-only'] ? null : spawn('ffmpeg', [
    '-y', '-loglevel', 'error', ...rawInput,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', video,
  ], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  const encoded = encoder ? completion(encoder) : null;
  // write callbacks report errors; retain a listener between writes as well.
  encoder?.stdin.on('error', () => {});
  let count = 0;
  let filled = 0;
  let writtenStills = 0;
  try {
    for await (const chunk of recorder.stdout) {
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(size - filled, chunk.length - offset);
        chunk.copy(frame, filled, offset, offset + length);
        filled += length;
        offset += length;
        if (filled !== size) continue;
        if (encoder) {
          // Await each write, bounding memory and propagating ffmpeg backpressure to Silk.
          await new Promise((resolve, reject) => {
            encoder.stdin.write(frame, error => error ? reject(error) : resolve());
          });
          if (selected.has(count)) {
            run('ffmpeg', ['-y', '-loglevel', 'error', ...rawInput,
              '-frames:v', '1', '-pix_fmt', 'rgb24',
              resolve(out, `${basename}-${selected.get(count)}s.png`)], {
              cwd: root, input: frame, stdio: ['pipe', 'inherit', 'inherit'],
            });
            writtenStills += 1;
          }
        }
        count += 1;
        filled = 0;
      }
    }
    encoder?.stdin.end();
    succeeded(await recorded, 'recorder');
    if (encoded) succeeded(await encoded, 'ffmpeg');
    if (count !== frames || filled !== 0) {
      throw new Error(`record: ${count} of ${frames} frames${filled ? `, ${filled} trailing bytes` : ''}`);
    }
  } finally {
    recorder.stdout.destroy();
    if (recorder.exitCode === null && recorder.signalCode === null) recorder.kill();
    if (encoder) {
      encoder.stdin.destroy();
      if (encoder.exitCode === null && encoder.signalCode === null) encoder.kill();
    }
    await Promise.all([recorded, encoded]);
  }
  console.log(`record: ${count} frames at ${width}x${height}`);
  if (encoder) {
    const gif = resolve(out, `${basename}.gif`);
    // 15 fps, 160 colors and ordered dithering keep the default clips compact.
    const filters = `fps=15,scale=${gifWidth}:-1:flags=lanczos,split[a][b];`
      + '[a]palettegen=max_colors=160:stats_mode=diff[p];'
      + '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', filters, '-loop', '0', gif]);
    console.log(`record: wrote ${video}, ${gif} and ${writtenStills} stills`);
  }
}
