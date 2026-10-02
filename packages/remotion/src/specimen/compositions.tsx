// Non-timeline compositions: GeneratedStill (NLE export of generated/solid sources), GlProbe (render GL probe),
// FontSpecimen (every registered face with FONT_TEST_STRING), StyleSpecimen (one component per frame, M2 contact sheet).
import type React from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { FONT_TEST_STRING, type StyleRenderTokens, type VisualSource } from "@docmaker/core";
import { EnvProvider, envFromTokens, fontStack } from "../data/env";
import { FontGate } from "../fonts/FontGate";
import { fontFaces } from "../fonts/registry";
import { OverlayItemView } from "../layers/OverlayItemView";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { coerceRenderTokens, DEFAULT_GRADE, DEFAULT_RENDER_TOKENS } from "./defaults";
import { sampleItem, SPECIMEN_IDS } from "./samples";

// ---------------------------------------------------------------- GeneratedStill
export type GeneratedStillProps = { source: VisualSource | null; tokens: unknown };

export const GeneratedStill: React.FC<GeneratedStillProps> = ({ source, tokens }) => {
  const env = useMemo(() => envFromTokens(coerceRenderTokens(tokens), { grade: DEFAULT_GRADE }), [tokens]);
  let body: React.ReactNode = null;
  if (source?.kind === "generated") body = <GeneratedBackdrop recipe={source.recipe} seed={source.seed} palette={source.palette} text={source.text} drift={false} />;
  else if (source?.kind === "solid") body = <AbsoluteFill style={{ backgroundColor: source.color }} />;
  return (
    <EnvProvider value={env}>
      <AbsoluteFill style={{ backgroundColor: env.tokens.tokens.palette.ink }}>
        <FontGate>{body}</FontGate>
      </AbsoluteFill>
    </EnvProvider>
  );
};

// ---------------------------------------------------------------- GlProbe
const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float; in vec2 uv; out vec4 o; void main(){ o = vec4(uv.x, uv.y, 0.6, 1.0); }`;

export interface GlProbeResult { ok: boolean; webgl2: boolean; renderer: string | null; vendor: string | null; version: string | null; error: string | null }

/** Creates a WebGL2 context, compiles and draws a tiny shader, reads the unmasked renderer. Never throws. */
export function probeWebGl(canvas: HTMLCanvasElement): GlProbeResult {
  const out: GlProbeResult = { ok: false, webgl2: false, renderer: null, vendor: null, version: null, error: null };
  try {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) {
      out.error = "webgl2 context unavailable";
      return out;
    }
    out.webgl2 = true;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    out.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    out.vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    out.version = String(gl.getParameter(gl.VERSION));
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.ok = px[3] === 255 && px[2]! > 100;
    if (!out.ok) out.error = `unexpected pixel ${Array.from(px).join(",")}`;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

export const GlProbe: React.FC = () => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!canvas.current) return;
    const r = probeWebGl(canvas.current);
    // the render package's probeGl() reads these two lines from onBrowserLog
    console.log(`UNMASKED_RENDERER_WEBGL=${r.renderer ?? "none"}`);
    console.log(`GL_PROBE ${JSON.stringify(r)}`);
    if (label.current) label.current.textContent = `${r.ok ? "OK" : "FAIL"} · ${r.renderer ?? r.error ?? "no renderer"}`;
  }, []);
  return (
    <AbsoluteFill style={{ backgroundColor: "#101214", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <canvas ref={canvas} width={320} height={180} style={{ width: 320, height: 180 }} />
      <div ref={label} style={{ color: "#FFFFFF", fontFamily: "monospace", fontSize: 14, maxWidth: 600, textAlign: "center" }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- FontSpecimen
export const FontSpecimen: React.FC = () => {
  const faces = fontFaces();
  const size = Math.min(52, Math.floor(1000 / faces.length / 1.25));
  return (
    <AbsoluteFill style={{ backgroundColor: "#F5F1E8", color: "#0B0B0D", padding: "36px 56px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <FontGate>
        {faces.map((f) => (
          <div key={`${f.family}-${f.weight}-${f.style}`} style={{ fontFamily: `"${f.family}"`, fontWeight: f.weight, fontStyle: f.style, fontSize: size, lineHeight: 1.25, whiteSpace: "nowrap" }}>
            {`${f.family} ${f.weight}${f.style === "italic" ? " italic" : ""} — ${FONT_TEST_STRING}`}
          </div>
        ))}
      </FontGate>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- StyleSpecimen (M2)
export type StyleSpecimenProps = { render: StyleRenderTokens | null; lang?: "en" | "fr" };
/** Local frame each component is captured at (after its entry). */
export const SPECIMEN_HERO_FRAME = 40;

export const StyleSpecimen: React.FC<StyleSpecimenProps> = ({ render, lang }) => {
  const f = useCurrentFrame();
  const tokens = render ?? DEFAULT_RENDER_TOKENS;
  const env = useMemo(() => envFromTokens(tokens, { grade: DEFAULT_GRADE, lang }), [tokens, lang]);
  const id = SPECIMEN_IDS[Math.min(SPECIMEN_IDS.length - 1, Math.max(0, f))]!;
  const item = sampleItem(id, tokens, env.fps, env.lang, 120);
  const hero = Math.min(SPECIMEN_HERO_FRAME, item.dur - item.exitFrames - 1);
  return (
    <EnvProvider value={env}>
      <AbsoluteFill style={{ backgroundColor: tokens.tokens.palette.ink }}>
        <FontGate styleFonts={tokens.fonts}>
          <Sequence durationInFrames={SPECIMEN_IDS.length} name="picture">
            <GeneratedBackdrop recipe="gradientGrid" seed={7} drift={false} />
          </Sequence>
          <OverlayItemView key={id} item={item} premount={0} from={f - hero} />
          <div style={{ position: "absolute", right: 24, bottom: 18, padding: "4px 10px", backgroundColor: "rgba(0,0,0,0.6)", color: "#FFFFFF", fontFamily: fontStack(tokens, "mono"), fontSize: 20 }}>{id}</div>
        </FontGate>
      </AbsoluteFill>
    </EnvProvider>
  );
};
export const STYLE_SPECIMEN_FRAMES = SPECIMEN_IDS.length;
