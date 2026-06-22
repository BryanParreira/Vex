const { execSync } = require('child_process')

exports.default = async function(context) {
  const { appOutDir } = context
  try {
    execSync(`xattr -rc "${appOutDir}"`, { stdio: 'pipe' })
  } catch (_) {}
}
