import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

if (process.platform === 'darwin') {
  await mkdir('native/bin', { recursive: true })
  for (const arch of ['arm64', 'x86_64']) {
    execFileSync('xcrun', ['clang', '-O2', '-fobjc-arc', '-dynamiclib', '-arch', arch,
      '-mmacosx-version-min=12.0', '-framework', 'AppKit', '-framework', 'ApplicationServices',
      '-Wl,-install_name,@rpath/selection-capture.dylib',
      'native/SelectionCapture.m', '-o', `native/bin/selection-capture-${arch}.dylib`], { stdio: 'inherit' })
  }
}
