// Engine runtime: configuration, secrets (re-read per job), logger, package adapters, style registry, fixtures.
import path from "node:path";
import { DocmakerError, FixtureManifest, type Logger, type Project, type RenderClient, type RuntimeConfig, type Secrets } from "@docmaker/core";
import { createLogger, loadRuntime } from "@docmaker/core/node";
import type { LlmClient } from "@docmaker/llm";
import type { StyleRegistry } from "@docmaker/styles";
import type { EngineDeps } from "./deps";
import { readJsonFile } from "./util";

export interface Runtime {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  config: RuntimeConfig;
  secrets: Secrets;
  logger: Logger;
  readonly deps: EngineDeps;
  readonly renderClient: RenderClient | null;
  readonly llmOverride: LlmClient | null;
  /** Re-reads the env chain (<home>/.env, .env.local) so key changes need no restart (§17.1). */
  refresh(): void;
  styles(force?: boolean): Promise<StyleRegistry>;
  fixture(id: string | null): Promise<FixtureManifest | null>;
  fixtureDir(id: string): string;
  llmFor(project: Project): LlmClient;
}

export function createRuntime(o: {
  cwd: string; env: NodeJS.ProcessEnv; deps: EngineDeps; renderClient: RenderClient | null; llmOverride: LlmClient | null; logger?: Logger;
}): Runtime {
  const first = loadRuntime({ cwd: o.cwd, env: o.env });
  let registry: Promise<StyleRegistry> | null = null;
  const fixtures = new Map<string, FixtureManifest | null>();
  const rt: Runtime = {
    cwd: o.cwd,
    env: o.env,
    config: first.config,
    secrets: first.secrets,
    logger: o.logger ?? createLogger({ level: first.config.logLevel, secrets: first.secrets }),
    deps: o.deps,
    renderClient: o.renderClient,
    llmOverride: o.llmOverride,
    refresh() {
      const r = loadRuntime({ cwd: o.cwd, env: o.env });
      // projectsDir/home stay those of the engine instance; only secrets and soft settings refresh.
      rt.secrets = r.secrets;
      rt.config = { ...rt.config, contact: r.config.contact, offline: r.config.offline, autoApproveUsd: r.config.autoApproveUsd, browserExecutable: r.config.browserExecutable, logLevel: r.config.logLevel };
    },
    styles(force = false) {
      if (!registry || force) {
        registry = o.deps.styles.discoverStyles({ repoRoot: rt.config.repoRoot, userStylesDir: rt.config.paths.styles });
        registry.catch(() => (registry = null));
      }
      return registry;
    },
    async fixture(id) {
      if (!id) return null;
      if (!/^[a-z0-9-]+$/.test(id)) throw new DocmakerError("VALIDATION", `invalid fixture id ${id}`);
      if (!fixtures.has(id)) {
        const raw = await readJsonFile(path.join(rt.fixtureDir(id), "fixture.json"));
        const parsed = raw === null ? null : FixtureManifest.safeParse(raw);
        fixtures.set(id, parsed?.success ? parsed.data : null);
      }
      return fixtures.get(id) ?? null;
    },
    fixtureDir(id) {
      return path.join(rt.config.repoRoot, "fixtures", id);
    },
    llmFor(project) {
      if (rt.llmOverride) return rt.llmOverride;
      if (project.llm.provider === "fixture") {
        if (!project.llm.fixtureId) throw new DocmakerError("FIXTURE_MISSING", "the project uses the fixture LLM without a fixture id");
        return o.deps.llm.createLlmClient({
          provider: "fixture", fixtureDir: rt.fixtureDir(project.llm.fixtureId), rawDir: "", refusalFallback: false, logger: rt.logger, apiKey: null,
        });
      }
      // Lazy: the SDK refuses to construct without a key, and most stages never call the LLM.
      let client: LlmClient | null = null;
      const get = (): LlmClient => {
        if (!client) {
          const key = rt.secrets.anthropic ?? null;
          if (!key) throw new DocmakerError("CONFIG_MISSING_KEY", "no Anthropic API key configured", { hint: "run `docmaker keys set anthropic` (or use a fixture project)" });
          client = o.deps.llm.createLlmClient({
            provider: "anthropic", fixtureDir: null, rawDir: path.join(rt.config.projectsDir, project.slug, "costs", "llm"),
            refusalFallback: project.llm.refusalFallback, logger: rt.logger, apiKey: key,
          });
        }
        return client;
      };
      return {
        kind: "anthropic",
        structured: (req, h) => get().structured(req, h),
        research: (req, h) => get().research(req, h),
      };
    },
  };
  return rt;
}
