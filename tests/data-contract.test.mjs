import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("versioned reference data satisfies the public lifecycle contract", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/validate-data.mjs"], {
    cwd: new URL("../", import.meta.url),
  });
  assert.match(stdout, /데이터 파일/);
  assert.match(stdout, /출처/);
});

test("ASOS 현재 지점 스냅샷은 좌표 기반 최근접 선택에 충분하다", async () => {
  const registry = JSON.parse(await readFile(
    new URL("../data/weather-stations/asos-2026-08-10.json", import.meta.url),
    "utf8",
  ));
  assert.equal(registry.stations.length, 97);
  assert.equal(new Set(registry.stations.map(({ id }) => id)).size, 97);
  assert.equal(registry.coordinateReferenceSystem, "EPSG:4326");

  const radians = (value) => value * Math.PI / 180;
  const distance = (station) => {
    const latitude = 37.5663;
    const longitude = 126.9779;
    const latitudeDelta = radians(station.latitude - latitude);
    const longitudeDelta = radians(station.longitude - longitude);
    const chord = Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(latitude)) * Math.cos(radians(station.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
    return 6_371.0088 * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
  };
  const nearest = [...registry.stations].sort((left, right) => distance(left) - distance(right))[0];
  assert.equal(nearest.id, "108");
  assert.equal(nearest.name, "서울");
});
