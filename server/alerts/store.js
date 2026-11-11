import { mkdir, readFile, writeFile, rename, open, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export class AlertStore {
  constructor(directory = process.env.ALERT_CACHE_DIR || ".cache/alerts") {
    this.directory = resolve(directory);
  }

  async read(name) {
    try {
      return JSON.parse(await readFile(join(this.directory, name + ".json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      // Fail closed on corrupted state, preserving the call-frequency guarantee.
      throw new Error("Alert cache cannot be read. Restore the persistent cache before retrying.");
    }
  }

  async write(name, value) {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, name + ".json");
    const temporary = target + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, target);
  }

  async lock() {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, "processing.lock");
    try {
      const handle = await open(path, "wx");
      return async () => {
        await handle.close();
        await unlink(path).catch(() => {});
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(path)).mtimeMs > 300000) {
          await unlink(path);
          return this.lock();
        }
      } catch (failure) {
        if (failure.code === "ENOENT") return this.lock();
        throw failure;
      }
      return null;
    }
  }
}
