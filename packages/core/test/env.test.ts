import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_UA_HOSTS } from "../src/index";
import { createLogger, findRepoRoot, loadRuntime, maskSecret, parseEnvFile, userAgentFor, writeSecret } from "../src/node/index";

async function fakeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "docmaker-env-"));
  await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "x", version: "9.9.9" }));
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  const home = path.join(root, "home");
  await mkdir(home);
  return { root, home };
}

describe("findRepoRoot / loadRuntime", () => {
  it("finds the nearest pnpm-workspace.yaml", async () => {
    const { root } = await fakeRepo();
    const prev = process.env.DOCMAKER_REPO_ROOT;
    delete process.env.DOCMAKER_REPO_ROOT;
    try {
      expect(findRepoRoot(path.join(root, "apps", "web"))).toBe(root);
    } finally {
      if (prev !== undefined) process.env.DOCMAKER_REPO_ROOT = prev;
    }
  });
  it("precedence: process.env > <home>/.env > <repoRoot>/.env.local", async () => {
    const { root, home } = await fakeRepo();
    await writeFile(path.join(root, ".env.local"), "ANTHROPIC_API_KEY=from-local\nPEXELS_API_KEY=pexels-local\nBRAVE_API_KEY=brave-local\nDOCMAKER_OFFLINE=1\n");
    await writeFile(path.join(home, ".env"), "export ANTHROPIC_API_KEY='from-home'\nPEXELS_API_KEY=\"pexels-home\" # comment\n");
    const env = { HOME: root, DOCMAKER_HOME: home, ANTHROPIC_API_KEY: "from-env", DOCMAKER_PROJECTS: "projects-x", USER: "alice", HOSTNAME: "box" } as NodeJS.ProcessEnv;
    const { secrets, config } = loadRuntime({ cwd: path.join(root, "apps", "web"), env });
    expect(secrets.anthropic).toBe("from-env");
    expect(secrets.pexels).toBe("pexels-home");
    expect(secrets.brave).toBe("brave-local");
    expect(secrets.elevenlabs).toBeUndefined();
    expect(config.repoRoot).toBe(root);
    expect(config.paths.home).toBe(home);
    expect(config.paths.envFile).toBe(path.join(home, ".env"));
    expect(config.projectsDir).toBe(path.join(root, "projects-x"));
    expect(config.offline).toBe(true);
    expect(config.ffmpeg).toBe("ffmpeg");
    expect(config.renderLockFile).toBe("/tmp/docmaker-render.lock");
    expect(config.userAgentBase).toBe("DocumentaryMaker/9.9.9");
    expect(config.contact).toBeNull();
    expect(config.browserExecutable).toBeNull();
    expect(JSON.stringify(config)).not.toMatch(/alice|box/);
  });
  it("contact and browser from home files; env overrides", async () => {
    const { root, home } = await fakeRepo();
    await writeFile(path.join(home, "config.json"), JSON.stringify({ contact: "me@example.org" }));
    await writeFile(path.join(home, "browser.json"), JSON.stringify({ executable: "/opt/chrome" }));
    const a = loadRuntime({ cwd: root, env: { DOCMAKER_HOME: home } }).config;
    expect(a.contact).toBe("me@example.org");
    expect(a.browserExecutable).toBe("/opt/chrome");
    const b = loadRuntime({ cwd: root, env: { DOCMAKER_HOME: home, DOCMAKER_CONTACT: "env@example.org", DOCMAKER_BROWSER_EXECUTABLE: "/x/chrome", DOCMAKER_RENDER_LOCK: "/tmp/l" } }).config;
    expect([b.contact, b.browserExecutable, b.renderLockFile]).toEqual(["env@example.org", "/x/chrome", "/tmp/l"]);
  });
});

describe("userAgentFor", () => {
  it("adds the contact only for allowlisted hosts", async () => {
    const { root, home } = await fakeRepo();
    const { config } = loadRuntime({ cwd: root, env: { DOCMAKER_HOME: home, DOCMAKER_CONTACT: "me@example.org" } });
    for (const h of CONTACT_UA_HOSTS) expect(userAgentFor(`https://${h}/w/api.php`, config)).toBe("DocumentaryMaker/9.9.9; contact: me@example.org");
    for (const u of ["https://api.pexels.com/v1", "https://evil.wikimedia.org.attacker.net/", "https://thumb.wikimedia.org/x.jpg", "https://en.wikipedia.org/wiki/X", "not a url"]) {
      expect(userAgentFor(u, config)).toBe("DocumentaryMaker/9.9.9");
    }
    const none = loadRuntime({ cwd: root, env: { DOCMAKER_HOME: home } }).config;
    expect(userAgentFor("https://commons.wikimedia.org/", none)).toBe("DocumentaryMaker/9.9.9");
  });
  it("never reads git config, the OS user or the hostname", () => {
    const src = readFileSync(new URL("../src/node/env.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/userInfo|hostname\(|\.gitconfig|git config|execSync|USERNAME|LOGNAME/);
  });
});

describe("secrets helpers", () => {
  it("maskSecret", () => {
    expect(maskSecret(undefined)).toBe("(unset)");
    expect(maskSecret("")).toBe("(unset)");
    expect(maskSecret("sk-ant-api03-abcdefghij9f3c")).toBe("sk-a…9f3c");
    expect(maskSecret("short")).toBe("…rt");
  });
  it("writeSecret writes <home>/.env with mode 0600 and replaces existing keys", async () => {
    const { home } = await fakeRepo();
    await writeSecret(home, "PEXELS_API_KEY", "abc");
    await writeSecret(home, "ANTHROPIC_API_KEY", "sk with space");
    await writeSecret(home, "PEXELS_API_KEY", "def");
    const text = await readFile(path.join(home, ".env"), "utf8");
    expect(parseEnvFile(text)).toEqual({ PEXELS_API_KEY: "def", ANTHROPIC_API_KEY: "sk with space" });
    expect((await stat(path.join(home, ".env"))).mode & 0o777).toBe(0o600);
    await expect(writeSecret(home, "bad name", "x")).rejects.toThrow();
    await expect(writeSecret(home, "X", "a\nb")).rejects.toThrow();
  });
  it("the logger redacts secret values and secret-like keys", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "debug", sink: (l) => lines.push(l), secrets: { anthropic: "sk-ant-SECRET-1234" } });
    log.info("calling with sk-ant-SECRET-1234", { headers: { authorization: "Bearer zzz", "x-api-key": "k" }, note: "token sk-ant-SECRET-1234", ok: 1 });
    log.child({ stage: "research" }).debug("x");
    createLogger({ level: "warn", sink: (l) => lines.push(l) }).info("hidden");
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toMatch(/SECRET|Bearer zzz|"k"/);
    expect(lines[0]).toMatch(/\[REDACTED\]/);
    expect(lines[1]).toMatch(/"stage":"research"/);
  });
});
