// Walking-skeleton fakes (§16.5). Every package's M1 has landed, so the assets/audio/export fakes are gone (P2): tests and
// the skeleton e2e run the real packages. Only the render client stays fake (no Chrome in unit tests): it writes an MP4
// with the timeline's exact frame count via ffmpeg.
export { FakeRenderClient } from "./render";
