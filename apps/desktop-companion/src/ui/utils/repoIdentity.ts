export interface RepoIdentity {
  readonly owner: string;
  readonly name: string;
}

export function parseRepoIdentity(url: string): RepoIdentity | undefined {
  // SSH: git@github.com:owner/name.git
  const sshMatch = url.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1] !== undefined && sshMatch[2] !== undefined) {
    return { owner: sshMatch[1], name: sshMatch[2] };
  }

  // HTTPS: https://github.com/owner/name.git
  const httpsMatch = url.match(/\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch?.[1] !== undefined && httpsMatch[2] !== undefined) {
    return { owner: httpsMatch[1], name: httpsMatch[2] };
  }

  return undefined;
}
