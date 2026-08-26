#!/usr/bin/env bash
# Install the official dsh browser bridge used by DeepSeek Sidebar.
# This script only installs/builds/registers the bridge plugin; the sidebar
# extension itself is loaded separately from this repository.
set -euo pipefail

REPOSITORY="${DSH_BRIDGE_REPOSITORY:-https://github.com/Lum1104/dsh-browser.git}"
REMOTE_REF="${DSH_BRIDGE_REF:-main}"
DSH_HOME_DIR="${DSH_HOME:-${HOME}/.dsh}"
UPSTREAM_ROOT="${DSH_BROWSER_ROOT:-${DSH_HOME_DIR}/dsh-browser}"
PROFILE_MANIFEST="${DSH_PROFILE_MANIFEST:-${DSH_HOME_DIR}/profiles/web/package.json}"
PLUGIN_PATH="${UPSTREAM_ROOT}/packages/browser/bridge-browser"
LEGACY_PLUGIN="@deepseek-ai/dsh-bridge-browser"
PNPM_VERSION="${DSH_BRIDGE_PNPM_VERSION:-11.7.0}"
TEMP_ROOT=""
PNPM_COMMAND=()
NODE_COMMAND="${DSH_BRIDGE_NODE_BIN:-}"

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEMP_ROOT" ] && [ -d "$TEMP_ROOT" ]; then
    rm -rf -- "$TEMP_ROOT"
  fi
}
trap cleanup EXIT HUP INT TERM

has_workspace() {
  local root="$1"
  [ -f "$root/package.json" ] &&
    [ -f "$root/pnpm-lock.yaml" ] &&
    [ -f "$root/packages/browser/bridge-browser/package.json" ]
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

prepare_upstream_workspace() {
  if has_workspace "$UPSTREAM_ROOT"; then
    return 0
  fi

  if [ -e "$UPSTREAM_ROOT" ] || [ -L "$UPSTREAM_ROOT" ]; then
    fail "$UPSTREAM_ROOT 已存在但不是完整的 dsh-browser checkout，为避免覆盖请手动处理该目录。"
  fi

  require_command curl '未找到 curl，请先安装 curl。'
  require_command tar '未找到 tar，请先安装 tar。'
  mkdir -p "$(dirname "$UPSTREAM_ROOT")"
  TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/deepseek-sidebar-dsh-bridge.XXXXXX")"
  local archive="$TEMP_ROOT/dsh-browser.tar.gz"
  local source="$TEMP_ROOT/source"
  local archive_url="${REPOSITORY%.git}/archive/refs/heads/${REMOTE_REF}.tar.gz"
  local curl_args=(--fail --location --silent --show-error --retry 3)
  if [ -n "${DSH_BRIDGE_PROXY:-}" ]; then
    curl_args+=(--proxy "$DSH_BRIDGE_PROXY")
  fi

  printf '正在下载 dsh-browser %s…\n' "$REMOTE_REF"
  mkdir -p "$source"
  curl "${curl_args[@]}" "$archive_url" --output "$archive"
  tar -xzf "$archive" -C "$source" --strip-components=1
  has_workspace "$source" || fail '下载的 dsh-browser 内容不完整，未修改现有目录。'
  mv "$source" "$UPSTREAM_ROOT"
  printf '已准备 dsh-browser：%s\n' "$UPSTREAM_ROOT"
}

resolve_pnpm() {
  if command -v corepack >/dev/null 2>&1; then
    PNPM_COMMAND=("$(command -v corepack)" pnpm)
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    local installed_version
    installed_version="$(pnpm --version 2>/dev/null || true)"
    if [[ "$installed_version" =~ ^(1[1-9]|[2-9][0-9])\. ]]; then
      PNPM_COMMAND=("$(command -v pnpm)")
      return 0
    fi
  fi
  if command -v npx >/dev/null 2>&1; then
    PNPM_COMMAND=("$(command -v npx)" --yes "pnpm@${PNPM_VERSION}")
    return 0
  fi
  fail "未找到 pnpm 11+、corepack 或 npx，请先安装/启用 pnpm ${PNPM_VERSION}。"
}

node_major() {
  "$1" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0\n'
}

if [ -z "$NODE_COMMAND" ]; then
  NODE_COMMAND="$(command -v node 2>/dev/null || true)"
fi
[ -n "$NODE_COMMAND" ] && [ -x "$NODE_COMMAND" ] || fail '未找到 Node.js，请先安装受支持的 Node.js 版本。'

# dsh-browser and the current dsh profile dependencies require a modern Node.
# DeepSeek Harness Desk ships one even when the user's shell still exposes an
# older system/Volta Node, so prefer that bundled runtime automatically.
if [ "$(node_major "$NODE_COMMAND")" -lt 22 ]; then
  DESK_NODE_ROOT="${DEEPSEEK_HARNESS_NODE_ROOT:-${HOME}/Library/Application Support/DeepSeek Harness Desk/runtime/node}"
  while IFS= read -r candidate; do
    if [ "$(node_major "$candidate")" -ge 22 ]; then
      NODE_COMMAND="$candidate"
    fi
  done < <(find "$DESK_NODE_ROOT" -mindepth 3 -maxdepth 3 -type f -name node -perm -111 2>/dev/null | sort)
fi
[ "$(node_major "$NODE_COMMAND")" -ge 22 ] || fail '需要 Node.js 22.13+（建议使用 DeepSeek Harness Desk 自带运行时），当前版本不受支持。'
export PATH="$(dirname "$NODE_COMMAND"):$PATH"
# dsh invokes pnpm again while editing a profile. Put the matching Corepack
# shim first as well, otherwise an older pnpm elsewhere on PATH can select a
# different store format and fail with ERR_PNPM_UNEXPECTED_STORE.
COREPACK_SHIM_DIR="$(dirname "$NODE_COMMAND")/../lib/node_modules/corepack/shims"
if [ -x "$COREPACK_SHIM_DIR/pnpm" ]; then
  export PATH="$COREPACK_SHIM_DIR:$PATH"
fi
prepare_upstream_workspace
resolve_pnpm

printf '正在构建官方浏览器 bridge…\n'
(
  cd "$UPSTREAM_ROOT"
  "${PNPM_COMMAND[@]}" install --frozen-lockfile
  "${PNPM_COMMAND[@]}" --filter @yuxianglin/dsh-bridge-browser run build
)

if [ ! -f "$PROFILE_MANIFEST" ]; then
  fail "未找到 web profile：$PROFILE_MANIFEST。请先启动一次 DeepSeek Harness，再重新运行本脚本。"
fi

printf '正在注册到 web profile…\n'
if "$NODE_COMMAND" -e '
  const manifest = require(process.argv[1]);
  process.exit(Object.hasOwn(manifest.dependencies ?? {}, process.argv[2]) ? 0 : 1);
' "$PROFILE_MANIFEST" "$LEGACY_PLUGIN"; then
  (
    cd "$UPSTREAM_ROOT"
    "${PNPM_COMMAND[@]}" exec dsh plugin --profile web remove "$LEGACY_PLUGIN"
  )
fi
(
  cd "$UPSTREAM_ROOT"
  "${PNPM_COMMAND[@]}" exec dsh plugin --profile web add -w "@yuxianglin/dsh-bridge-browser@link:$PLUGIN_PATH"
)

printf '\n安装完成。\n'
printf '• 已注册：@yuxianglin/dsh-bridge-browser\n'
printf '• DSH 地址默认：http://127.0.0.1:3080/\n'
printf '• Chrome 回环连接无需填写 token；远程连接才需要填写：%s\n' "$DSH_HOME_DIR/ext-bridge-token"
printf '• 若 DSH 已在运行，请重启它使 web profile 重新加载 bridge。\n'
