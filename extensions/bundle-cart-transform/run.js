export default function run(input) {
  const operations = [];
  const bundles = new Map();

  for (const line of input.cart.lines || []) {
    const bundleId = getAttribute(line, "_rc_bundle");
    if (!bundleId) continue;

    if (!bundles.has(bundleId)) {
      bundles.set(bundleId, []);
    }
    bundles.get(bundleId).push(line);
  }

  for (const [, bundleLines] of bundles) {
    if (bundleLines.length < 2) continue;

    const parentLine = findParent(bundleLines);
    if (!parentLine) continue;

    const cartLineIds = bundleLines.map((line) => line.id);

    operations.push({
      merge: {
        parentCartLineId: parentLine.id,
        cartLineIds,
      },
    });
  }

  return { operations };
}

function getAttribute(line, key) {
  return (line.attributes || []).find((attr) => attr.key === key)?.value;
}

function findParent(lines) {
  const explicitParent = lines.find((line) => {
    const bundleVariant = getAttribute(line, "_rc_bundle_variant");
    const merchandiseId = line.merchandise?.id;

    if (!bundleVariant || !merchandiseId) return false;

    return merchandiseId.endsWith(bundleVariant);
  });

  if (explicitParent) return explicitParent;

  return lines[0];
}
