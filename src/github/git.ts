import { runCommand } from "../util/exec.js";

const BOT_NAME = "greenlight[bot]";
const BOT_EMAIL = "greenlight-bot@users.noreply.github.com";

async function git(root: string, args: string): Promise<string> {
  const r = await runCommand(`git ${args}`, { cwd: root, timeoutSec: 120 });
  if (r.exitCode !== 0) throw new Error(`git ${args.split(" ")[0]} failed:\n${r.output}`);
  return r.output.trim();
}

/** Commit the given files on a new or existing branch and push it to origin. */
export async function commitAndPush(
  root: string,
  opts: { branch: string; files: string[]; message: string; createBranch: boolean },
): Promise<string> {
  if (opts.createBranch) await git(root, `checkout -B "${opts.branch}"`);
  await git(root, `add -- ${opts.files.map((f) => `"${f}"`).join(" ")}`);
  await git(
    root,
    `-c user.name="${BOT_NAME}" -c user.email="${BOT_EMAIL}" commit -m "${opts.message.replace(/"/g, '\\"')}"`,
  );
  await git(root, `push ${opts.createBranch ? "--force-with-lease " : ""}origin "HEAD:refs/heads/${opts.branch}"`);
  return git(root, "rev-parse HEAD");
}

export async function headCommitAuthor(root: string): Promise<string> {
  return git(root, "log -1 --format=%an");
}

export { BOT_NAME };
