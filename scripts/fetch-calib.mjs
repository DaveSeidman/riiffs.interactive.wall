// Finds connected ZED cameras (via macOS system_profiler), downloads each one's factory
// calibration from Stereolabs into public/calibration/, and writes index.json so the app
// can offer/auto-select the right file per camera.  Usage: npm run calib
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/calibration/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const tree = JSON.parse(execFileSync('system_profiler', ['SPUSBHostDataType', '-json'], { encoding: 'utf8' }));
const found = [];
(function walk(n) {
  if (Array.isArray(n)) return n.forEach(walk);
  if (!n || typeof n !== 'object') return;
  const name = String(n._name ?? '');
  const serial = n.USBDeviceKeySerialNumber;
  // The ZED's HID interface (IMU) carries the real serial; the video interface doesn't
  if (/^ZED.*HID INTERFACE$/i.test(name) && /^\d+$/.test(serial ?? '')) {
    let model = name.replace(/\s*HID INTERFACE$/i, '').replace(/^ZED-/i, 'ZED ');
    if (/^ZED M$/i.test(model)) model = 'ZED Mini';
    found.push({ serial, model });
  }
  Object.values(n).forEach(walk);
})(tree);

const indexUrl = new URL('index.json', OUT);
const index = existsSync(indexUrl) ? JSON.parse(readFileSync(indexUrl, 'utf8')) : [];
for (const { serial, model } of found) {
  const file = `SN${serial}.conf`;
  const dest = new URL(file, OUT);
  if (!existsSync(dest)) {
    const res = await fetch(`https://calib.stereolabs.com/?SN=${serial}`);
    if (!res.ok) {
      console.error(`✗ ${model} ${serial}: HTTP ${res.status}`);
      continue;
    }
    writeFileSync(dest, await res.text());
  }
  const entry = index.find((e) => e.serial === serial);
  if (entry) Object.assign(entry, { model, file });
  else index.push({ serial, model, file });
  console.log(`✓ ${model}  SN ${serial}  -> public/calibration/${file}`);
}
if (!found.length) console.log('No ZED cameras found on USB.');
writeFileSync(indexUrl, JSON.stringify(index, null, 2) + '\n');
