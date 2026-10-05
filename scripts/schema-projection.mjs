import assert from 'node:assert/strict';

// Adapt compiler input only. json-schema-to-typescript still compiles the types;
// canonical JSON and the engine's full Ajv registry never use this projection.
export function projectForTypes(schema, local) {
  function project(value, path) {
    if (Array.isArray(value)) return value.map((item, i) => project(item, `${path}/${i}`));
    if (!value || typeof value !== 'object') return value;
    const projected = Object.fromEntries(Object.entries(value).map(([key, val]) => {
      if (key === '$ref' && typeof val === 'string' && val.startsWith('urn:')) {
        const [id, fragment] = val.split('#');
        assert(local.has(id), `Unknown schema URN ${id}`);
        return [key, local.get(id) + (fragment ? '#' + fragment : '')];
      }
      return [key, project(val, `${path}/${key}`)];
    }));
    if (!Array.isArray(projected.allOf)) return projected;

    // The reviewed conditionals are standalone allOf branches. The pinned
    // compiler cannot model them; exclude only that documented shape rather
    // than intersecting its permissive dictionaries with structural objects.
    const branches = projected.allOf.filter(branch => {
      if (!branch || typeof branch !== 'object' || !Object.hasOwn(branch, 'if')) return true;
      assert(Object.keys(branch).every(key => ['if', 'then', 'else'].includes(key)),
        `Unsupported mixed conditional projection at ${path}; add an explicit projection proof`);
      return false;
    });
    const { allOf: _allOf, ...base } = projected;
    if (!branches.length) return base;

    // Unnamed object siblings otherwise disappear in compiler 15.0.4. Put them
    // in an explicit structural branch; keep schema metadata/definitions at
    // the root so local fragment resolution and generated naming stay intact.
    const metadata = {}, structure = {};
    for (const [key, val] of Object.entries(base)) {
      (['$schema', '$id', '$defs', 'definitions', 'title', 'description', '$comment'].includes(key)
        ? metadata : structure)[key] = val;
    }
    return { ...metadata, allOf: [...(Object.keys(structure).length ? [structure] : []), ...branches] };
  }
  return project(schema, '#');
}
