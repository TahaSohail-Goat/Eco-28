/** Derive "-lite" residence props from the shipped models for phones, tablets
 * and the distant garden trees. Run resize-lite-textures.py afterwards.
 * Leaf cards are thinned by whole card (survivors enlarged to keep the canopy
 * full); solid parts are simplified with meshoptimizer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
MeshoptSimplifier.useExperimentalFeatures = true;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/media/residence-realism");
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

// keep: fraction of leaf cards retained; solid: target ratio for other parts.
const budgets = {
  island_tree_02: { leaf: /leav/i, keep: 4, grow: 1.55, solid: 0.18, prune: true },
  potted_plant_01: { leaf: /leav/i, keep: 2, grow: 1.3, solid: 0.4 },
  potted_plant_04: { solid: 0.35 },
  dining_chair_02: { solid: 0.25 },
  mid_century_lounge_chair: { solid: 0.4 },
};

function decode(model, folder) {
  const source = fs.readFileSync(path.join(folder, model.buffers[0].uri));
  return model.accessors.map(accessor => {
    const view = model.bufferViews[accessor.bufferView];
    const C = types[accessor.componentType], n = components[accessor.type];
    const ext = view.extensions?.EXT_meshopt_compression;
    if (!ext) throw new Error("Expected meshopt-compressed views");
    const target = new Uint8Array(ext.count * ext.byteStride);
    const input = source.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, input, ext.mode, ext.filter);
    return new C(target.buffer, (accessor.byteOffset ?? 0), accessor.count * n);
  });
}

function thinCards(indices, positions, keep, grow) {
  const parent = new Uint32Array(positions.length / 3).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < indices.length; i += 3) {
    const a = find(indices[i]); parent[find(indices[i + 1])] = a; parent[find(indices[i + 2])] = a;
  }
  const ids = new Map();
  const kept = [];
  for (let i = 0; i < indices.length; i += 3) {
    const group = find(indices[i]);
    if (!ids.has(group)) ids.set(group, ids.size);
    if (ids.get(group) % keep === 0) kept.push(indices[i], indices[i + 1], indices[i + 2]);
  }
  const centers = new Map();
  for (const v of new Set(kept)) {
    const g = find(v); if (!centers.has(g)) centers.set(g, [0, 0, 0, 0]);
    const c = centers.get(g); for (let a = 0; a < 3; a++) c[a] += positions[v * 3 + a]; c[3]++;
  }
  for (const v of new Set(kept)) {
    const c = centers.get(find(v));
    for (let a = 0; a < 3; a++) { const m = c[a] / c[3]; positions[v * 3 + a] = m + (positions[v * 3 + a] - m) * grow; }
  }
  return new Uint32Array(kept);
}

for (const [name, budget] of Object.entries(budgets)) {
  const folder = path.join(root, name);
  const model = JSON.parse(fs.readFileSync(path.join(folder, "scene.gltf"), "utf8"));
  const data = decode(model, folder);
  const views = [], accessors = [], chunks = [];
  let offset = 0, before = 0, after = 0;
  const append = (array, type, componentType, normalized) => {
    const n = components[type], count = array.length / n, stride = array.BYTES_PER_ELEMENT * n;
    const mode = type === "SCALAR" ? "INDICES" : "ATTRIBUTES";
    const raw = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const compressed = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode);
    views.push({ buffer: 1, byteOffset: 0, byteLength: raw.length, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: compressed.length, byteStride: stride, count, mode } } });
    chunks.push(compressed); offset += compressed.length;
    const accessor = { bufferView: views.length - 1, componentType, count, type };
    if (normalized) accessor.normalized = true;
    if (type === "VEC3" && componentType === 5126) {
      accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) {
        accessor.min[a] = Math.min(accessor.min[a], array[i * 3 + a]); accessor.max[a] = Math.max(accessor.max[a], array[i * 3 + a]);
      }
    }
    accessors.push(accessor); return accessors.length - 1;
  };
  let rawBytes = 0;
  for (const mesh of model.meshes) for (const primitive of mesh.primitives) {
    const material = model.materials[primitive.material]?.name ?? "";
    const positions = Float32Array.from(data[primitive.attributes.POSITION]);
    let indices = Uint32Array.from(data[primitive.indices]);
    before += indices.length / 3;
    if (budget.leaf?.test(material)) indices = thinCards(indices, positions, budget.keep, budget.grow);
    else {
      const target = Math.floor(indices.length * budget.solid / 3) * 3;
      [indices] = budget.prune
        ? MeshoptSimplifier.simplify(indices, positions, 3, target, 0.05, ["Prune"])
        : MeshoptSimplifier.simplify(indices, positions, 3, target, 0.02, ["LockBorder"]);
    }
    after += indices.length / 3;
    if (process.env.LITE_VERBOSE) console.log(`  ${material}: ${data[primitive.indices].length / 3} -> ${indices.length / 3}`);
    const remap = new Map(), used = [];
    const dense = indices.map(v => { if (!remap.has(v)) { remap.set(v, used.length); used.push(v); } return remap.get(v); });
    const attributes = {};
    for (const [key, index] of Object.entries(primitive.attributes)) {
      const accessor = model.accessors[index], n = components[accessor.type];
      const src = key === "POSITION" ? positions : data[index];
      const out = new src.constructor(used.length * n);
      used.forEach((v, i) => out.set(src.subarray(v * n, v * n + n), i * n));
      attributes[key] = append(out, accessor.type, accessor.componentType, accessor.normalized);
      rawBytes += out.byteLength;
    }
    primitive.attributes = attributes;
    primitive.indices = append(dense, "SCALAR", 5125);
    rawBytes += dense.byteLength;
  }
  model.bufferViews = views; model.accessors = accessors;
  model.buffers = [{ uri: "scene.bin", byteLength: offset }, { byteLength: rawBytes, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  // Fallback buffer byte offsets must be laid out sequentially.
  let fallback = 0; for (const v of views) { v.byteOffset = fallback; fallback += (v.byteLength + 3) & ~3; }
  model.buffers[1].byteLength = fallback;
  model.asset.extras = { ...model.asset.extras, lite: `Derived from ../${name} by scripts/assets/lite-residence-models.mjs` };
  const out = path.join(root, `${name}-lite`);
  fs.mkdirSync(path.join(out, "textures"), { recursive: true });
  for (const image of model.images ?? []) fs.copyFileSync(path.join(folder, image.uri), path.join(out, image.uri));
  fs.writeFileSync(path.join(out, "scene.bin"), Buffer.concat(chunks));
  fs.writeFileSync(path.join(out, "scene.gltf"), JSON.stringify(model) + "\n");
  console.log(`${name}-lite: ${before} -> ${after} triangles, ${Math.round(offset / 1024)} KiB geometry`);
}
