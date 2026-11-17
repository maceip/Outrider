#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROTO_DIR="${REPO_ROOT}/prototypes/astryx-control-plane"
ASTRYX_DIR="${REPO_ROOT}/vendor/meta-astryx"

if [ ! -d "${ASTRYX_DIR}" ]; then
  echo "Cloning meta/astryx into ${ASTRYX_DIR}..."
  mkdir -p "${REPO_ROOT}/vendor"
  git clone --depth 1 https://github.com/meta/astryx.git "${ASTRYX_DIR}"
  (cd "${ASTRYX_DIR}" && pnpm install && pnpm build)
fi

echo "Syncing Conduit MCP Control Plane route & Playground templates into ${ASTRYX_DIR}..."
mkdir -p "${ASTRYX_DIR}/apps/docsite/src/app/conduit"
cp -R "${PROTO_DIR}/conduit/"* "${ASTRYX_DIR}/apps/docsite/src/app/conduit/"

mkdir -p "${ASTRYX_DIR}/packages/cli/assets/templates/pages"
cp -R "${PROTO_DIR}/templates/"* "${ASTRYX_DIR}/packages/cli/assets/templates/pages/"

(
  cd "${ASTRYX_DIR}"
  UPDATE_SHADCN_ROUTE_LOCK=1 node apps/docsite/scripts/generate-data.mjs
)

echo "Done! Run:"
echo "  cd vendor/meta-astryx/apps/docsite && pnpm exec next dev --webpack -p 3100"
echo "Then open /conduit or /playground."
