import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "@xzare/core";
import { Runtime } from "./runtime.js";
import { validateBackup } from "./backup.js";
import { openDatabase } from "@xzare/db";
it("Education backups restore actual students, revoke sessions and reject other product files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xzare-education-backup-")),
    r = new Runtime(
      join(dir, "education"),
      "unused",
      "a".repeat(64),
      undefined,
      "education",
    );
  try {
    const password = "Education-restore-123!",
      { token } = (await r.call("setup", {
        businessName: "QA Center",
        name: "QA",
        username: "owner",
        password,
      })) as any;
    for (const a of ["state", "crm.state", "hr.state", "invoice.post"])
      await expect(r.call(a, {}, token)).rejects.toThrow();
    const save = (code: string) =>
      r.call(
        "edu.student.save",
        {
          code,
          name: code,
          phone: "",
          guardian: "",
          guardianPhone: "",
          birthDay: null,
          level: "",
          note: "",
          active: true,
          clientTxnId: ulid(),
        },
        token,
      );
    await save("S01");
    const file = join(dir, "education.xzbak");
    await r.backup(token, file);
    for (const p of ["pos", "crm", "hr"] as const)
      expect(() => validateBackup(file, dir, p)).toThrow();
    await save("S02");
    await r.restore(token, password, file);
    await expect(r.call("edu.state", {}, token)).rejects.toThrow();
    const login = (await r.call("login", {
      username: "owner",
      password,
    })) as any;
    expect(
      ((await r.call("edu.state", {}, login.token)) as any).students.map(
        (x: any) => x.code,
      ),
    ).toEqual(["S01"]);
    r.close();
    expect(() =>
      openDatabase(join(dir, "education", "xzare.sqlite"), "crm"),
    ).toThrow("foreign");
  } finally {
    r.close();
    if (!dir.startsWith(join(tmpdir(), "xzare-education-backup-")))
      throw new Error("unsafe cleanup");
    rmSync(dir, { recursive: true, force: true });
  }
});
