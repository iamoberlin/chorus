#!/usr/bin/env bash
# CHORUS Release Audit
# Checks all release artifacts against package.json version.
# Exit 0 = all good. Exit 1 = something's stale.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$HOME/.openclaw/extensions/chorus"

VERSION=$(node -e "process.stdout.write(require('$REPO_DIR/package.json').version)")
MAJOR_MINOR=$(echo "$VERSION" | sed 's/\.[0-9]*$//')

FAIL=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=1; }

echo "CHORUS Release Audit — v$VERSION"
echo "═══════════════════════════════"
echo ""

# 1. openclaw.plugin.json
PLUGIN_VER=$(node -e "process.stdout.write(require('$REPO_DIR/openclaw.plugin.json').version || 'missing')")
if [ "$PLUGIN_VER" = "$VERSION" ]; then pass "openclaw.plugin.json ($PLUGIN_VER)"
else fail "openclaw.plugin.json ($PLUGIN_VER != $VERSION)"; fi

# 2. Extension
if [ -f "$EXT_DIR/package.json" ]; then
  EXT_VER=$(node -e "process.stdout.write(require('$EXT_DIR/package.json').version)")
  if [ "$EXT_VER" = "$VERSION" ]; then pass "Extension ($EXT_VER)"
  else fail "Extension ($EXT_VER != $VERSION)"; fi
else
  fail "Extension not found"
fi

# 3. Docs site version string
if grep -q "v$MAJOR_MINOR" "$REPO_DIR/docs/index.html" 2>/dev/null; then
  pass "Docs site (v$MAJOR_MINOR found)"
else
  fail "Docs site (v$MAJOR_MINOR not found in docs/index.html)"
fi

# 4. README "What's New" section
if grep -qi "v$MAJOR_MINOR" "$REPO_DIR/README.md" 2>/dev/null; then
  pass "README (v$MAJOR_MINOR referenced)"
else
  fail "README (v$MAJOR_MINOR not referenced)"
fi

# 5. NPM (skip if not published yet)
NPM_VER=$(npm info @iamoberlin/chorus version 2>/dev/null || echo "unpublished")
if [ "$NPM_VER" = "unpublished" ]; then
  echo "  ⏭️  NPM (not published, skipping)"
elif [ "$NPM_VER" = "$VERSION" ]; then
  pass "NPM ($NPM_VER)"
else
  fail "NPM ($NPM_VER != $VERSION)"
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "All checks passed ✅"
else
  echo "Release incomplete — fix failures above ❌"
fi

exit $FAIL
