import { Config } from "@remotion/cli/config";

// Frames are rendered as JPEG for speed; the V3 CLI passes codec/quality per mode (önizleme/final).
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
