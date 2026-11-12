import { Config } from "@remotion/cli/config";

// Frames are rendered as JPEG for speed, at a high quality (Remotion's default is 80): x264 compresses every frame again,
// so it should start from a clean one. The V3 CLI passes codec/quality per mode (önizleme/final).
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
