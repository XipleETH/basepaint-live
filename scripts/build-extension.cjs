const esbuild = require("esbuild");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

esbuild.buildSync({
  absWorkingDir: projectRoot,
  entryPoints: ["./extension/page-bridge.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: path.join(projectRoot, "extension/page-bridge.bundle.js"),
});

esbuild.buildSync({
  absWorkingDir: projectRoot,
  entryPoints: ["./extension/livekit-content.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: path.join(projectRoot, "extension/livekit-content.bundle.js"),
});

esbuild.buildSync({
  absWorkingDir: projectRoot,
  entryPoints: ["./extension/offscreen.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: path.join(projectRoot, "extension/offscreen.bundle.js"),
});

esbuild.buildSync({
  absWorkingDir: projectRoot,
  entryPoints: ["./extension/viewer.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: path.join(projectRoot, "extension/viewer.bundle.js"),
});
