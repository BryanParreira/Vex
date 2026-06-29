/**
 * electron-builder beforePack hook.
 * Swaps in the correct Python runtime (arm64 or x64) before each arch-specific build.
 *
 * In CI: python-runtime-arm64/ and python-runtime-x64/ are pre-built by the workflow.
 * In local dev: downloads and installs on demand (slow but automatic).
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const PY_VERSION = '3.12.7'
const PY_BUILD   = '20241016'

// electron-builder Arch enum: x64=1, arm64=3
function archName(archEnum) {
  return archEnum === 3 ? 'arm64' : 'x64'
}
function pyArch(arch) {
  return arch === 'arm64' ? 'aarch64' : 'x86_64'
}

exports.default = async (context) => {
  const arch = archName(context.arch)
  const runtimeDir = path.join(__dirname, 'python-runtime')
  const prebuiltDir = path.join(__dirname, `python-runtime-${arch}`)

  // Remove previous runtime
  if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true })

  if (fs.existsSync(prebuiltDir)) {
    // CI path: copy the pre-built runtime for this arch
    console.log(`[pack-hook] Using pre-built ${arch} Python runtime`)
    fs.cpSync(prebuiltDir, runtimeDir, { recursive: true })
  } else {
    // Dev path: download python-build-standalone + pip install on the fly
    const pa   = pyArch(arch)
    const archive = `cpython-${PY_VERSION}+${PY_BUILD}-${pa}-apple-darwin-install_only.tar.gz`
    const url = `https://github.com/indygreg/python-build-standalone/releases/download/${PY_BUILD}/${archive}`

    console.log(`[pack-hook] Downloading Python ${PY_VERSION} for ${arch} — this takes a few minutes...`)
    const parentDir = path.dirname(runtimeDir)
    execSync(`curl -fL "${url}" | tar xz -C "${parentDir}"`, { stdio: 'inherit' })
    fs.renameSync(path.join(parentDir, 'python'), runtimeDir)

    const pip = path.join(runtimeDir, 'bin', 'pip3')
    const req = path.join(__dirname, '..', 'api', 'requirements.txt')
    console.log(`[pack-hook] Installing Python dependencies...`)
    const arch_prefix = arch === 'x64' ? 'arch -x86_64 ' : ''
    execSync(`${arch_prefix}"${pip}" install --no-cache-dir --quiet -r "${req}"`, { stdio: 'inherit' })
    console.log(`[pack-hook] Python runtime ready`)
  }
}
