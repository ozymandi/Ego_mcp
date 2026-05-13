import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";

export interface Workspace {
  name: string;
  path: string;
  description?: string;
}

export interface WorkspaceInfo extends Workspace {
  exists: boolean;
  is_directory: boolean;
}

interface Persisted {
  workspaces: Record<string, { path: string; description?: string }>;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/;

// Block list of paths that are usually a bad idea to register as a model's
// workspace. The user can override with `force: true` if they really mean it.
const DANGEROUS_PREFIXES_WIN = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
];
const DANGEROUS_PREFIXES_POSIX = ["/etc", "/bin", "/sbin", "/usr", "/var", "/System", "/Library/System"];

export class WorkspaceRegistry {
  private store: Map<string, Workspace> = new Map();
  private readonly persistPath: string;

  constructor(persistPath: string) {
    this.persistPath = persistPath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.persistPath)) {
      this.store = new Map();
      return;
    }
    try {
      const data = JSON.parse(
        readFileSync(this.persistPath, "utf8"),
      ) as Persisted;
      this.store = new Map(
        Object.entries(data.workspaces ?? {}).map(([name, v]) => [
          name,
          { name, path: v.path, description: v.description },
        ]),
      );
    } catch (err) {
      console.error(
        `[workspaces] failed to load ${this.persistPath}: ${(err as Error).message}; starting empty`,
      );
      this.store = new Map();
    }
  }

  private save(): void {
    const data: Persisted = {
      workspaces: Object.fromEntries(
        Array.from(this.store.values()).map((w) => [
          w.name,
          { path: w.path, description: w.description },
        ]),
      ),
    };
    const dir = path.dirname(this.persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
  }

  list(): WorkspaceInfo[] {
    const out: WorkspaceInfo[] = [];
    for (const w of this.store.values()) {
      let exists = false;
      let isDir = false;
      try {
        const st = statSync(w.path);
        exists = true;
        isDir = st.isDirectory();
      } catch {
        // missing
      }
      out.push({ ...w, exists, is_directory: isDir });
    }
    return out;
  }

  get(name: string): Workspace {
    const w = this.store.get(name);
    if (!w) {
      const known = Array.from(this.store.keys()).join(", ") || "(none)";
      throw new Error(
        `Unknown workspace '${name}'. Registered: ${known}. Use register_workspace to add one.`,
      );
    }
    return w;
  }

  register(opts: {
    name: string;
    path: string;
    description?: string;
    force?: boolean;
  }): Workspace {
    if (!NAME_RE.test(opts.name)) {
      throw new Error(
        `Invalid workspace name '${opts.name}'. Use letters, digits, underscore, hyphen; 1–50 chars; start with letter/digit.`,
      );
    }
    if (!path.isAbsolute(opts.path)) {
      throw new Error(`Workspace path must be absolute: '${opts.path}'`);
    }
    const resolved = path.resolve(opts.path);
    if (!existsSync(resolved)) {
      throw new Error(
        `Directory does not exist: ${resolved}. Create it first or pass a valid path.`,
      );
    }
    if (!statSync(resolved).isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }
    if (!opts.force) {
      const reason = whyDangerous(resolved);
      if (reason) {
        throw new Error(
          `Refusing to register '${resolved}' (${reason}). Pass force=true to override.`,
        );
      }
    }
    if (this.store.has(opts.name)) {
      throw new Error(
        `Workspace '${opts.name}' is already registered. Use unregister_workspace first if you want to change it.`,
      );
    }
    const w: Workspace = {
      name: opts.name,
      path: resolved,
      description: opts.description,
    };
    this.store.set(opts.name, w);
    this.save();
    return w;
  }

  unregister(name: string): Workspace {
    const w = this.store.get(name);
    if (!w) throw new Error(`Workspace '${name}' is not registered`);
    this.store.delete(name);
    this.save();
    return w;
  }

  // Resolve a path inside a workspace, throwing if it escapes the root.
  resolveInside(workspaceName: string, relative: string): string {
    const w = this.get(workspaceName);
    if (typeof relative !== "string") relative = "";
    // Normalize separators; reject absolute paths supplied by the model.
    if (path.isAbsolute(relative)) {
      throw new Error(
        `Path inside workspace must be relative. Got: '${relative}'`,
      );
    }
    const full = path.resolve(w.path, relative);
    const rel = path.relative(w.path, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `Path escapes workspace '${workspaceName}': '${relative}'`,
      );
    }
    return full;
  }
}

function whyDangerous(absPath: string): string | null {
  const lc = absPath.toLowerCase();
  if (process.platform === "win32") {
    // Refuse a raw drive root like "C:\" or "D:\\"
    if (/^[a-z]:\\?$/i.test(absPath)) return "drive root";
    for (const p of DANGEROUS_PREFIXES_WIN) {
      if (lc === p || lc.startsWith(p + "\\")) return `system folder (${p})`;
    }
    // Also refuse the bare user profile root (e.g. C:\Users\foo) — too broad.
    const userProfile = process.env.USERPROFILE
      ? process.env.USERPROFILE.toLowerCase()
      : null;
    if (userProfile && lc === userProfile) return "user profile root";
  } else {
    if (absPath === "/") return "filesystem root";
    for (const p of DANGEROUS_PREFIXES_POSIX) {
      if (lc === p || lc.startsWith(p + "/")) return `system folder (${p})`;
    }
    const home = process.env.HOME;
    if (home && absPath === home) return "user home root";
  }
  return null;
}
