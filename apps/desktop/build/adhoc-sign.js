// electron-builder afterPack hook: ad-hoc sign the macOS bundle.
// With mac.identity=null electron-builder skips signing, leaving the .app with only per-binary
// linker signatures and no sealed resources (_CodeSignature/CodeResources). On Apple silicon a
// quarantined, unsealed bundle is rejected ("THYNKPDF is damaged and can't be opened").
// Ad-hoc signing (`--sign -`) needs no Apple Developer account and seals every nested Mach-O,
// including the PyInstaller sidecar in Resources/thynkpdf-server.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const run = (args) => execFileSync("codesign", args, { stdio: "inherit" });
  // Sidecar first (inside-out), then the whole bundle.
  execFileSync("/bin/sh", ["-c",
    `find "${app}/Contents/Resources/thynkpdf-server" -type f \\( -perm -u+x -o -name '*.dylib' -o -name '*.so' \\) -exec codesign --force --sign - --timestamp=none {} +`],
    { stdio: "inherit" });
  run(["--force", "--deep", "--sign", "-", "--timestamp=none", app]);
  run(["--verify", "--deep", "--strict", "--verbose=2", app]);
  console.log(`ad-hoc signed ${app}`);
};
