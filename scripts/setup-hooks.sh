#!/bin/sh
# Points this checkout at the tracked .githooks directory. The hook wrappers
# run the machine's global hooks (sign-off, commit-msg format, signed push)
# first, so a repo-local core.hooksPath does not hide them.
# Run once per clone (or per worktree in a bare-repo layout).
set -eu
HOOKS_DIR='.githooks'
top=$(git rev-parse --show-toplevel)
git -C "$top" config --local core.hooksPath "$HOOKS_DIR"
echo "core.hooksPath=$HOOKS_DIR (global hooks still run first)"
