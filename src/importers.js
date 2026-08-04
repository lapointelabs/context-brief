import { contextPath } from "./project.js";
import { taskScaffold } from "./tasks.js";
import { exists, isoNow, slugify, writeJson } from "./util.js";

function parseGithubReference(reference, configuredRepository) {
  const raw = reference.replace(/^github:/, "");
  const match = raw.match(/^(?:(?<repository>[^#]+))?#(?<number>\d+)$/);
  if (!match) throw new Error("GitHub reference must look like github:owner/repository#123 or github:#123.");
  const repository = match.groups.repository || configuredRepository;
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error("A GitHub owner/repository is required in the reference or config.integrations.github.repository.");
  }
  return { repository, number: Number(match.groups.number) };
}

export async function importGithubTask(project, reference, options = {}) {
  const { repository, number } = parseGithubReference(reference, project.config.integrations?.github?.repository);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "context-brief-cli",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${repository}/issues/${number}`, { headers });
  } catch (error) {
    throw new Error(`GitHub request failed: ${error.message}`);
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status}: ${await response.text()}`);
  const issue = await response.json();
  const id = options.id || slugify(`gh-${number}-${issue.title}`).slice(0, 80);
  const filePath = contextPath(project, "tasks", `${id}.json`);
  if (await exists(filePath) && !options.force) throw new Error(`Task ${id} already exists. Use --force to replace it.`);
  const task = taskScaffold(id, issue.title);
  task.outcome = issue.title;
  task.why = issue.body || "";
  task.scope.in = [`Resolve GitHub issue ${repository}#${number}.`];
  task.source = { type: "github", reference: issue.html_url, importedAt: isoNow() };
  await writeJson(filePath, task);
  return { task, filePath };
}
