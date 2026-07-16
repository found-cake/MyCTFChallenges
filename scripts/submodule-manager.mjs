#!/usr/bin/env node

/**
 * Manage Git submodule additions and manual update pull requests.
 *
 * Runtime dependencies: Node.js standard library and Git only.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PREVIEW_MARKER = '<!-- submodule-manager-preview -->';
export const NO_RESPONSE = '_No response_';
export const CONFIRMATION_TEXT = 'I checked the repository and parent path for mistakes.';

// Leave this list empty to allow repositories from every owner.
// Add one or more owner names to restrict new submodules to those owners.
export const whitelist_owner = [
  // 'example',
];

const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

const DEFAULT_CONFIG = Object.freeze({
  allowed_hosts: ['github.com'],
  authenticated_hosts: ['github.com'],
  allow_root: true,
  portable_paths: true,
  prevent_duplicate_repository: true,
  prevent_case_insensitive_path: true,
});

export class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
  }
}

function redact(value, secret) {
  if (!secret) return value;
  return value
    .split(secret).join('***')
    .split(encodeURIComponent(secret)).join('***');
}

function repositoryLocation(value) {
  const original = String(value).trim();
  if (!original.includes('://')) {
    const scp = original.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
    if (scp) {
      const host = scp[1].toLowerCase();
      return { host, authority: host, repositoryPath: scp[2] };
    }
  }

  try {
    const parsed = new URL(original);
    if (!parsed.hostname) return null;
    const host = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol.toLowerCase();
    const defaultPort = new Map([
      ['git:', '9418'],
      ['http:', '80'],
      ['https:', '443'],
      ['ssh:', '22'],
    ]).get(protocol);
    const authority = parsed.port ? `${host}:${parsed.port}` : host;
    return {
      host,
      authority,
      identityAuthority: parsed.port && parsed.port !== defaultPort ? authority : host,
      repositoryPath: parsed.pathname,
    };
  } catch {
    return null;
  }
}

export function runGit(
  args,
  {
    check = true,
    timeout = 45_000,
    cwd = process.cwd(),
    targetUrls = [],
    authenticatedHosts = [],
    env: suppliedEnv = {},
  } = {},
) {
  const env = {
    ...process.env,
    ...suppliedEnv,
    GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT || '0',
  };

  const token = env.SUBMODULE_TOKEN || '';
  const username = env.SUBMODULE_TOKEN_USERNAME || 'x-access-token';
  const urls = Array.isArray(targetUrls) ? targetUrls : [targetUrls];
  const targets = new Map();
  for (const url of urls) {
    const location = repositoryLocation(url);
    if (location) targets.set(location.authority, location);
  }
  const credentialHosts = new Set(authenticatedHosts.map((host) => String(host).toLowerCase()));
  const configEntries = [];
  for (const { host, authority } of targets.values()) {
    // Remove actions/checkout's origin-scoped Authorization header from target-remote commands.
    configEntries.push([`http.https://${authority}/.extraheader`, '']);
    if (!token || !credentialHosts.has(host)) continue;

    const credentialBase = `https://${encodeURIComponent(username)}:${encodeURIComponent(token)}@${authority}/`;
    const sourceBases = [`https://${authority}/`, `ssh://git@${authority}/`];
    if (authority === host) sourceBases.push(`git@${host}:`);
    for (const sourceBase of sourceBases) {
      configEntries.push([`url.${credentialBase}.insteadOf`, sourceBase]);
    }
  }
  if (configEntries.length > 0) {
    const existingCountValue = env.GIT_CONFIG_COUNT || '0';
    if (!/^\d+$/.test(existingCountValue)) {
      throw new RequestError('GIT_CONFIG_COUNT must be a non-negative integer.');
    }
    const existingCount = Number(existingCountValue);
    env.GIT_CONFIG_COUNT = String(existingCount + configEntries.length);
    for (const [index, [key, value]] of configEntries.entries()) {
      env[`GIT_CONFIG_KEY_${existingCount + index}`] = key;
      env[`GIT_CONFIG_VALUE_${existingCount + index}`] = value;
    }
  }

  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    const message = result.error.code === 'ETIMEDOUT'
      ? `git ${args.slice(0, 2).join(' ')} timed out`
      : result.error.message;
    throw new RequestError(redact(message, token));
  }

  const normalized = {
    returncode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };

  if (check && normalized.returncode !== 0) {
    const detail = normalized.stderr.trim() || normalized.stdout.trim() || 'unknown Git error';
    throw new RequestError(
      `git ${args.slice(0, 2).join(' ')} failed: ${redact(detail, token)}`,
    );
  }

  return normalized;
}

export function loadJson(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new RequestError(`Failed to read JSON '${path}': ${error.message}`);
  }

  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new RequestError(`JSON object expected: ${path}`);
  }
  return value;
}

export function loadConfig(path) {
  const config = {
    ...DEFAULT_CONFIG,
    allowed_hosts: [...DEFAULT_CONFIG.allowed_hosts],
    authenticated_hosts: [...DEFAULT_CONFIG.authenticated_hosts],
  };

  let authenticatedHostsSupplied = false;
  if (existsSync(path)) {
    const supplied = loadJson(path);
    authenticatedHostsSupplied = Object.hasOwn(supplied, 'authenticated_hosts');
    const unknown = Object.keys(supplied)
      .filter((key) => !Object.hasOwn(DEFAULT_CONFIG, key))
      .sort();
    if (unknown.length > 0) {
      throw new RequestError(`Unknown config key(s): ${unknown.join(', ')}`);
    }
    Object.assign(config, supplied);
  }

  const normalizeHosts = (value, key, allowEmpty) => {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      throw new RequestError(`${key} must be ${allowEmpty ? 'a' : 'a non-empty'} JSON array`);
    }
    const hosts = value.map((host) => String(host).trim().toLowerCase());
    for (const host of hosts) {
      let parsed;
      try {
        parsed = new URL(`https://${host}`);
      } catch {
        throw new RequestError(`${key} contains an invalid hostname: ${host || '(empty)'}`);
      }
      if (!host || parsed.hostname.toLowerCase() !== host || parsed.port || parsed.pathname !== '/') {
        throw new RequestError(`${key} contains an invalid hostname: ${host || '(empty)'}`);
      }
    }
    if (new Set(hosts).size !== hosts.length) {
      throw new RequestError(`${key} must not contain duplicate hostnames`);
    }
    return hosts;
  };

  config.allowed_hosts = normalizeHosts(config.allowed_hosts, 'allowed_hosts', false);
  if (!authenticatedHostsSupplied) {
    config.authenticated_hosts = config.authenticated_hosts.filter(
      (host) => config.allowed_hosts.includes(host),
    );
  }
  config.authenticated_hosts = normalizeHosts(
    config.authenticated_hosts,
    'authenticated_hosts',
    true,
  );
  for (const host of config.authenticated_hosts) {
    if (!config.allowed_hosts.includes(host)) {
      throw new RequestError(`authenticated host '${host}' must also appear in allowed_hosts`);
    }
  }

  for (const key of [
    'allow_root',
    'portable_paths',
    'prevent_duplicate_repository',
    'prevent_case_insensitive_path',
  ]) {
    if (typeof config[key] !== 'boolean') {
      throw new RequestError(`${key} must be true or false`);
    }
  }

  return config;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseIssueBody(body) {
  const result = {};
  for (const heading of ['Repository', 'Parent path', 'Directory name', 'Branch']) {
    const pattern = new RegExp(
      `^### ${escapeRegExp(heading)}\\s*\\n+([\\s\\S]*?)(?=\\n### |$)`,
      'm',
    );
    const match = body.match(pattern);
    if (!match) {
      throw new RequestError(`Missing Issue Form field: ${heading}`);
    }
    const value = match[1].trim();
    result[heading] = value === NO_RESPONSE ? '' : value;
  }

  if (!result.Repository) {
    throw new RequestError('Repository is required.');
  }
  const confirmation = body.match(
    /^### Confirmation\s*\n+([\s\S]*?)(?=\n### |$)/m,
  );
  if (!confirmation) {
    throw new RequestError('Missing Issue Form field: Confirmation');
  }
  const checkedConfirmation = new RegExp(
    `^-\\s+\\[[xX]\\]\\s+${escapeRegExp(CONFIRMATION_TEXT)}$`,
  );
  if (!confirmation[1].split('\n').some((line) => checkedConfirmation.test(line.trim()))) {
    throw new RequestError('Confirmation must be checked.');
  }
  return result;
}

export function validateNoControls(value, field) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 32 || code === 127) {
      throw new RequestError(`${field} contains a control character.`);
    }
  }
}

export function normalizeRepository(value, allowedHosts, whitelistOwners = whitelist_owner) {
  let original = String(value).trim();
  validateNoControls(original, 'Repository');

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(original)) {
    original = `https://github.com/${original}`;
  }

  let parsed;
  try {
    parsed = new URL(original);
  } catch {
    throw new RequestError('Repository must use an HTTPS URL or the owner/repository shorthand.');
  }

  if (parsed.protocol.toLowerCase() !== 'https:') {
    throw new RequestError('Repository must use an HTTPS URL or the owner/repository shorthand.');
  }
  if (parsed.port) {
    throw new RequestError('Repository URLs must not use a non-default port.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new RequestError('Repository URL must not contain credentials, a query, or a fragment.');
  }

  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) {
    throw new RequestError(
      `Repository host '${host || '(missing)'}' is not allowed. Allowed hosts: ${allowedHosts.join(', ')}`,
    );
  }

  let repositoryPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
  if (/\.git$/i.test(repositoryPath)) {
    repositoryPath = repositoryPath.slice(0, -4);
  }
  const parts = repositoryPath ? repositoryPath.split('/') : [];
  if (parts.length < 2) {
    throw new RequestError('Repository URL must contain an owner/group and repository name.');
  }
  if (parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new RequestError('Repository URL contains an unsupported owner or repository name.');
  }

  const repositoryOwner = parts[0];
  if (!Array.isArray(whitelistOwners)) {
    throw new RequestError('whitelist_owner must be an array.');
  }

  const normalizedWhitelist = whitelistOwners.map((owner) => {
    const normalizedOwner = String(owner).trim();
    if (!normalizedOwner || !/^[A-Za-z0-9_.-]+$/.test(normalizedOwner)) {
      throw new RequestError(`Invalid owner in whitelist_owner: ${String(owner)}`);
    }
    return normalizedOwner.toLowerCase();
  });

  if (
    normalizedWhitelist.length > 0
    && !normalizedWhitelist.includes(repositoryOwner.toLowerCase())
  ) {
    throw new RequestError(
      `Repository owner '${repositoryOwner}' is not allowed. Allowed owners: ${whitelistOwners.join(', ')}`,
    );
  }

  const repositoryName = parts.at(-1);
  return {
    repositoryUrl: `https://${host}/${parts.join('/')}.git`,
    repositoryOwner,
    repositoryName,
  };
}

export function validateSegment(value, field, portable) {
  const normalized = String(value).trim();
  if (!normalized) {
    throw new RequestError(`${field} must not be empty.`);
  }
  validateNoControls(normalized, field);
  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new RequestError(`${field} must be a single path segment.`);
  }
  if (normalized === '.' || normalized === '..' || normalized.toLowerCase() === '.git') {
    throw new RequestError(`${field} cannot be '.', '..', or '.git'.`);
  }

  if (portable) {
    if (/[<>:"|?*]/.test(normalized)) {
      throw new RequestError(`${field} contains a character unsupported on Windows.`);
    }
    if (normalized.endsWith(' ') || normalized.endsWith('.')) {
      throw new RequestError(`${field} cannot end with a space or period.`);
    }
    const basename = normalized.split('.', 1)[0].toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(basename)) {
      throw new RequestError(`${field} uses a Windows reserved name: ${basename}`);
    }
  }

  return normalized;
}

export function validateParentPath(value, { allowRoot, portable }) {
  const normalized = String(value).trim();
  if (!normalized || normalized === '.') {
    if (allowRoot) {
      return '';
    }
    throw new RequestError('Adding submodules at the repository root is disabled.');
  }

  validateNoControls(normalized, 'Parent path');
  if (normalized.includes('\\')) {
    throw new RequestError("Parent path must use '/' as its path separator.");
  }
  if (normalized.startsWith('/') || normalized.endsWith('/') || normalized.includes('//')) {
    throw new RequestError('Parent path must be a normalized relative path.');
  }

  return normalized
    .split('/')
    .map((part) => validateSegment(part, 'Parent path segment', portable))
    .join('/');
}

export function validateBranch(value) {
  const branch = String(value).trim();
  if (!branch) {
    return '';
  }
  validateNoControls(branch, 'Branch');
  const result = runGit(['check-ref-format', '--branch', branch], { check: false });
  if (result.returncode !== 0) {
    throw new RequestError('Branch is not a valid Git branch name.');
  }
  return branch;
}

export function repositoryKey(url) {
  const location = repositoryLocation(url);
  if (!location) {
    return String(url).replace(/\.git$/i, '').toLowerCase();
  }
  const host = location.host;
  let repositoryPath = location.repositoryPath.replace(/^\/+|\/+$/g, '');
  if (/\.git$/i.test(repositoryPath)) {
    repositoryPath = repositoryPath.slice(0, -4);
  }
  if (host === 'github.com') {
    repositoryPath = repositoryPath.toLowerCase();
  }
  return `${location.identityAuthority || location.authority}/${repositoryPath}`;
}

function configValues(root, suffix) {
  const gitmodules = join(root, '.gitmodules');
  const result = runGit(
    ['config', '--file', gitmodules, '--get-regexp', `^submodule\\..*\\.${suffix}$`],
    { check: false, cwd: root },
  );
  if (![0, 1].includes(result.returncode)) {
    throw new RequestError(result.stderr.trim() || 'Failed to read .gitmodules');
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.match(/^\S+\s+([\s\S]*)$/);
      return match ? match[1] : '';
    });
}

export function readGitmodules(root) {
  const gitmodules = join(root, '.gitmodules');
  if (!existsSync(gitmodules)) {
    return { urls: [], paths: [] };
  }
  return {
    urls: configValues(root, 'url'),
    paths: configValues(root, 'path'),
  };
}

function listTrackedPaths(root) {
  const result = runGit(['ls-files', '-z', '--cached'], { check: false, cwd: root });
  if (result.returncode !== 0) {
    throw new RequestError(result.stderr.trim() || 'Failed to list tracked paths.');
  }
  return result.stdout.split('\0').filter(Boolean);
}

function portableCaseFold(value) {
  return value.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFC');
}

function pathsConflictOnCaseInsensitiveFileSystem(existingPath, targetPath) {
  const existingParts = existingPath.normalize('NFC').split('/');
  const targetParts = targetPath.normalize('NFC').split('/');
  const sharedLength = Math.min(existingParts.length, targetParts.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const existingPart = existingParts[index];
    const targetPart = targetParts[index];
    if (portableCaseFold(existingPart) !== portableCaseFold(targetPart)) return false;
    if (existingPart !== targetPart) return true;
  }
  return true;
}

function assertSafeTargetPath(root, targetPath, existingSubmodulePaths, caseInsensitive) {
  const trackedPaths = listTrackedPaths(root);
  for (const existingPath of [...existingSubmodulePaths, ...trackedPaths]) {
    if (existingPath === targetPath) {
      throw new RequestError('The target path already exists in the repository.');
    }
    if (
      caseInsensitive
      && pathsConflictOnCaseInsensitiveFileSystem(existingPath, targetPath)
    ) {
      throw new RequestError(
        `The target path conflicts with tracked path '${existingPath}' on a case-insensitive file system.`,
      );
    }
  }

  try {
    lstatSync(join(root, ...targetPath.split('/')));
    throw new RequestError('The target path already exists in the repository.');
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error?.code !== 'ENOENT') {
      throw new RequestError(`Failed to inspect the target path: ${error.message}`);
    }
  }
}

function assertSafeParentDirectories(root, targetPath) {
  let current = root;
  for (const part of targetPath.split('/').slice(0, -1)) {
    current = join(current, part);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw new RequestError(`Failed to inspect target parent '${part}': ${error.message}`);
    }
    if (metadata.isSymbolicLink()) {
      throw new RequestError('Target path parents must not contain symbolic links.');
    }
    if (!metadata.isDirectory()) {
      throw new RequestError('Every existing target path parent must be a directory.');
    }
  }
}

export function listSubmodules(root) {
  const gitmodules = join(root, '.gitmodules');
  if (!existsSync(gitmodules)) {
    return [];
  }

  const result = runGit(
    ['config', '--file', gitmodules, '--name-only', '--get-regexp', '^submodule\\..*\\.path$'],
    { check: false, cwd: root },
  );
  if (![0, 1].includes(result.returncode)) {
    throw new RequestError(result.stderr.trim() || 'Failed to read .gitmodules');
  }

  const submodules = [];
  for (const rawKey of result.stdout.split('\n')) {
    const key = rawKey.trim();
    if (!key) continue;
    const match = key.match(/^submodule\.(.+)\.path$/);
    if (!match) continue;
    const name = match[1];

    const configValue = (field) => {
      const valueResult = runGit(
        ['config', '--file', gitmodules, '--get', `submodule.${name}.${field}`],
        { check: false, cwd: root },
      );
      if (valueResult.returncode === 1) return '';
      if (valueResult.returncode !== 0) {
        throw new RequestError(
          valueResult.stderr.trim() || `Failed to read submodule.${name}.${field}`,
        );
      }
      return valueResult.stdout.replace(/\n$/, '');
    };

    const path = configValue('path');
    const url = configValue('url');
    const branch = configValue('branch');
    if (!path || !url) {
      throw new RequestError(`Submodule '${name}' is missing its path or URL.`);
    }
    validateNoControls(path, 'Submodule path');
    validateNoControls(url, 'Submodule URL');
    validateNoControls(branch, 'Submodule branch');
    submodules.push({ name, path, url, branch });
  }
  return submodules;
}

export function selectSubmodules(root, requestedPath) {
  const submodules = listSubmodules(root);
  if (submodules.length === 0) {
    throw new RequestError('No submodules are registered in .gitmodules.');
  }

  const requested = String(requestedPath).trim();
  validateNoControls(requested, 'Update path');
  if (!requested) return submodules;

  const normalized = requested.replace(/\/+$/, '');
  const match = submodules.find((submodule) => submodule.path === normalized);
  if (match) return [match];

  const available = submodules.map((submodule) => `- ${submodule.path}`).join('\n');
  throw new RequestError(
    `Submodule path is not registered in .gitmodules: ${requested}\nAvailable paths:\n${available}`,
  );
}

export function gitlinkCommit(root, path) {
  const result = runGit(['ls-tree', '-z', 'HEAD', '--', path], { check: false, cwd: root });
  if (result.returncode !== 0) {
    throw new RequestError(`The superproject does not track a gitlink at '${path}'.`);
  }
  const entry = result.stdout.replace(/\0+$/, '');
  const tab = entry.indexOf('\t');
  if (!entry || tab === -1) {
    throw new RequestError(`The superproject does not track a gitlink at '${path}'.`);
  }
  const metadata = entry.slice(0, tab).split(/\s+/);
  const trackedPath = entry.slice(tab + 1);
  if (metadata.length !== 3 || metadata[0] !== '160000' || metadata[1] !== 'commit') {
    throw new RequestError(`The superproject does not track a gitlink at '${path}'.`);
  }
  if (trackedPath !== path) {
    throw new RequestError(`Unexpected gitlink path returned for '${path}'.`);
  }
  if (!/^[0-9a-fA-F]{40,64}$/.test(metadata[2])) {
    throw new RequestError(`Unexpected gitlink value for '${path}'.`);
  }
  return metadata[2];
}

export function workingTreeCommit(root, path) {
  const result = runGit(['-C', path, 'rev-parse', 'HEAD'], { check: false, cwd: root });
  if (result.returncode !== 0) {
    throw new RequestError(`Failed to read the updated commit for '${path}'.`);
  }
  const commit = result.stdout.trim();
  if (!/^[0-9a-fA-F]{40,64}$/.test(commit)) {
    throw new RequestError(`Unexpected updated commit value for '${path}'.`);
  }
  return commit;
}

export function updateSubmodules(root, requestedPath, authenticatedHosts = ['github.com']) {
  const selected = selectSubmodules(root, requestedPath);
  const paths = selected.map((submodule) => submodule.path);
  const before = new Map(selected.map((submodule) => [submodule.path, gitlinkCommit(root, submodule.path)]));

  const targetUrls = selected.map((submodule) => submodule.url);
  runGit(
    ['submodule', 'sync', '--', ...paths],
    { cwd: root, targetUrls, authenticatedHosts },
  );
  runGit(
    ['submodule', 'update', '--init', '--remote', '--checkout', '--', ...paths],
    { cwd: root, targetUrls, authenticatedHosts, timeout: 900_000 },
  );

  const changes = [];
  for (const submodule of selected) {
    const oldCommit = before.get(submodule.path);
    const newCommit = workingTreeCommit(root, submodule.path);
    if (newCommit !== oldCommit) {
      changes.push({
        path: submodule.path,
        url: submodule.url,
        branch: submodule.branch,
        old_commit: oldCommit,
        new_commit: newCommit,
      });
    }
  }
  return { selected, changes };
}

function remoteCommit(output, ref) {
  for (const line of output.split('\n')) {
    const separator = line.indexOf('\t');
    if (separator === -1 || line.slice(separator + 1) !== ref) continue;
    const commit = line.slice(0, separator);
    if (/^[0-9a-fA-F]{40,64}$/.test(commit)) return commit;
  }
  return '';
}

export function inspectRemote(repositoryUrl, branch, authenticatedHosts = ['github.com']) {
  const result = runGit(['ls-remote', '--symref', repositoryUrl, 'HEAD'], {
    check: false,
    targetUrls: repositoryUrl,
    authenticatedHosts,
  });
  if (result.returncode !== 0) {
    const lines = result.stderr.trim().split('\n').filter(Boolean);
    const detail = lines.at(-1) || 'unknown error';
    throw new RequestError(
      `Repository is not reachable: ${redact(detail, process.env.SUBMODULE_TOKEN || '')}`,
    );
  }

  let defaultBranch = '';
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/);
    if (match) {
      defaultBranch = match[1];
      break;
    }
  }

  if (branch) {
    const branchResult = runGit(
      ['ls-remote', '--exit-code', '--heads', repositoryUrl, `refs/heads/${branch}`],
      { check: false, targetUrls: repositoryUrl, authenticatedHosts },
    );
    if (branchResult.returncode !== 0) {
      throw new RequestError(`Branch '${branch}' does not exist in the target repository.`);
    }
    const commit = remoteCommit(branchResult.stdout, `refs/heads/${branch}`);
    if (!commit) throw new RequestError(`Failed to resolve branch '${branch}'.`);
    return { defaultBranch, selectedBranch: branch, commit };
  }

  const commit = remoteCommit(result.stdout, 'HEAD');
  if (!defaultBranch || !commit) {
    throw new RequestError('The remote default branch could not be resolved.');
  }
  return { defaultBranch, selectedBranch: defaultBranch, commit };
}

export function inspectRequest({
  eventPath,
  configPath = '.github/submodule-manager.json',
  root = '.',
  skipRemoteCheck = false,
}) {
  const absoluteRoot = resolve(root);
  const config = loadConfig(configPath);
  const event = loadJson(eventPath);
  const issue = event.issue;
  if (issue === null || Array.isArray(issue) || typeof issue !== 'object') {
    throw new RequestError('GitHub event does not contain an issue.');
  }
  if (typeof issue.body !== 'string') {
    throw new RequestError('Issue body is missing.');
  }

  const fields = parseIssueBody(issue.body);
  const { repositoryUrl, repositoryName } = normalizeRepository(
    fields.Repository,
    config.allowed_hosts,
  );
  const parentPath = validateParentPath(fields['Parent path'], {
    allowRoot: config.allow_root,
    portable: config.portable_paths,
  });
  const directoryName = validateSegment(
    fields['Directory name'] || repositoryName,
    'Directory name',
    config.portable_paths,
  );
  const branch = validateBranch(fields.Branch);
  const targetPath = parentPath ? posix.join(parentPath, directoryName) : directoryName;
  const remote = skipRemoteCheck
    ? { defaultBranch: '', selectedBranch: branch, commit: '' }
    : inspectRemote(repositoryUrl, branch, config.authenticated_hosts);

  const { urls: existingUrls, paths: existingPaths } = readGitmodules(absoluteRoot);
  if (config.prevent_duplicate_repository) {
    const requestedKey = repositoryKey(repositoryUrl);
    if (existingUrls.some((existingUrl) => repositoryKey(existingUrl) === requestedKey)) {
      throw new RequestError('The same repository is already registered in .gitmodules.');
    }
  }

  assertSafeTargetPath(
    absoluteRoot,
    targetPath,
    existingPaths,
    config.prevent_case_insensitive_path,
  );
  assertSafeParentDirectories(absoluteRoot, targetPath);

  return {
    repository_input: fields.Repository,
    repository_url: repositoryUrl,
    repository_name: repositoryName,
    parent_path: parentPath,
    directory_name: directoryName,
    target_path: targetPath,
    branch,
    remote_default_branch: remote.defaultBranch,
    resolved_branch: remote.selectedBranch,
    resolved_commit: remote.commit,
    remote_verified: !skipRemoteCheck,
  };
}

export function previewMarkdown(request, error) {
  const lines = [PREVIEW_MARKER, '## Submodule request preview', ''];
  if (error) {
    lines.push(
      '❌ **Validation failed**',
      '',
      `> ${code(error)}`,
      '',
      'Edit the issue to correct the request. The preview will update automatically.',
    );
    return `${lines.join('\n')}\n`;
  }

  const selectedBranch = request.branch || request.remote_default_branch || 'remote default branch';
  lines.push(
    '✅ **The request is valid.**',
    '',
    '| Item | Value |',
    '| --- | --- |',
    `| Repository | ${code(request.repository_url)} |`,
    `| Target path | ${code(request.target_path)} |`,
    `| Branch | ${code(selectedBranch)} |`,
    '',
    'A repository collaborator with write access can create the pull request by commenting:',
    '',
    '```text',
    '/approve',
    '```',
    '',
    'The current issue contents are validated again at approval time.',
  );
  return `${lines.join('\n')}\n`;
}

function code(value) {
  const encoded = [...String(value)]
    .map((character) => `&#${character.codePointAt(0)};`)
    .join('');
  return `<code>${encoded}</code>`;
}

export function approvalMarkdown(request, issueNumber) {
  const issue = String(issueNumber);
  if (!/^[1-9]\d*$/.test(issue)) {
    throw new RequestError('Issue number must be a positive integer.');
  }
  const selectedBranch = request.branch || request.remote_default_branch || 'remote default branch';
  return `${[
    '## Submodule request',
    '',
    `- Repository: ${code(request.repository_url)}`,
    `- Target path: ${code(request.target_path)}`,
    `- Branch: ${code(selectedBranch)}`,
    '',
    `Closes #${issue}`,
  ].join('\n')}\n`;
}

export function updateMarkdown(selected, changes, requestedPath) {
  const scope = String(requestedPath).trim() || 'all registered submodules';
  const lines = ['## Submodule update', '', `- Scope: ${code(scope)}`, ''];

  if (changes.length === 0) {
    lines.push(
      '✅ Every selected submodule is already at the latest tracked commit.',
      '',
      `Checked ${selected.length} submodule(s).`,
    );
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    `Updated ${changes.length} of ${selected.length} selected submodule(s).`,
    '',
    '| Path | Tracking | Previous | Updated |',
    '| --- | --- | --- | --- |',
  );
  for (const change of changes) {
    const tracking = change.branch || 'remote default branch';
    lines.push(
      `| ${code(change.path)} | ${code(tracking)} | ${code(change.old_commit.slice(0, 12))} | ${code(change.new_commit.slice(0, 12))} |`,
    );
  }
  lines.push(
    '',
    'The pull request updates only the superproject gitlinks. Review the linked repositories before merging.',
  );
  return `${lines.join('\n')}\n`;
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const COMMAND_OPTIONS = Object.freeze({
  inspect: Object.freeze({
    booleans: new Set(['skip_remote_check', 'strict']),
    values: new Set(['event', 'output', 'markdown', 'config', 'root']),
  }),
  apply: Object.freeze({
    booleans: new Set(),
    values: new Set(['request', 'config', 'root']),
  }),
  'github-output': Object.freeze({
    booleans: new Set(),
    values: new Set(['request', 'issue', 'markdown']),
  }),
  update: Object.freeze({
    booleans: new Set(),
    values: new Set(['path', 'output', 'markdown', 'config', 'root']),
  }),
  'update-output': Object.freeze({
    booleans: new Set(),
    values: new Set(['result']),
  }),
  'stage-update': Object.freeze({
    booleans: new Set(),
    values: new Set(['result', 'root']),
  }),
});

function parseCli(argv) {
  const [command, ...tokens] = argv;
  if (!command) throw new RequestError('A command is required.');
  const schema = Object.hasOwn(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : null;
  if (!schema) throw new RequestError(`Unknown command: ${command}`);

  const options = Object.create(null);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      throw new RequestError(`Unexpected argument: ${token}`);
    }
    if (token.includes('=')) {
      throw new RequestError(`Option values must be separate arguments: ${token}`);
    }
    const key = token.slice(2).replaceAll('-', '_');
    if (!schema.booleans.has(key) && !schema.values.has(key)) {
      throw new RequestError(`Unknown option for ${command}: ${token}`);
    }
    if (Object.hasOwn(options, key)) {
      throw new RequestError(`Option may only be specified once: ${token}`);
    }
    if (schema.booleans.has(key)) {
      options[key] = true;
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined) {
      throw new RequestError(`Option requires a value: ${token}`);
    }
    options[key] = next;
    index += 1;
  }
  return { command, options };
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || !value) {
    throw new RequestError(`--${key.replaceAll('_', '-')} is required.`);
  }
  return value;
}

function commandInspect(options) {
  let request = null;
  let error = '';
  try {
    request = inspectRequest({
      eventPath: required(options, 'event'),
      configPath: options.config || '.github/submodule-manager.json',
      root: options.root || '.',
      skipRemoteCheck: options.skip_remote_check === true,
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const result = {
    valid: !error,
    error,
    request: request || {},
  };
  writeJson(required(options, 'output'), result);
  writeFileSync(required(options, 'markdown'), previewMarkdown(request, error), 'utf8');

  if (options.strict === true && error) {
    throw new RequestError(error);
  }
}

function validatedRequestResolution(request) {
  if (request === null || Array.isArray(request) || typeof request !== 'object') {
    throw new RequestError('Request metadata is missing.');
  }
  const branch = validateBranch(request.branch || '');
  const remoteDefaultBranch = validateBranch(request.remote_default_branch || '');
  const resolvedBranch = validateBranch(request.resolved_branch || '');
  const resolvedCommit = String(request.resolved_commit || '').toLowerCase();
  if (request.remote_verified !== true) {
    throw new RequestError('Request metadata was not verified against the remote repository.');
  }
  if (!resolvedBranch || resolvedBranch !== (branch || remoteDefaultBranch)) {
    throw new RequestError('Validated branch metadata is missing or inconsistent.');
  }
  if (!/^[0-9a-f]{40,64}$/.test(resolvedCommit)) {
    throw new RequestError('Validated commit metadata is missing or invalid.');
  }
  return { branch, remoteDefaultBranch, resolvedBranch, resolvedCommit };
}

function commandApply(options) {
  const root = resolve(options.root || '.');
  const config = loadConfig(options.config || '.github/submodule-manager.json');
  const result = loadJson(required(options, 'request'));
  if (!result.valid) {
    throw new RequestError(result.error || 'Request is invalid.');
  }
  const request = result.request;
  const { branch, resolvedCommit } = validatedRequestResolution(request);

  const suppliedRepositoryUrl = String(request.repository_url || '');
  const { repositoryUrl } = normalizeRepository(
    suppliedRepositoryUrl,
    config.allowed_hosts,
  );
  if (repositoryUrl !== suppliedRepositoryUrl) {
    throw new RequestError('Request repository metadata is not normalized.');
  }

  const suppliedTargetPath = String(request.target_path || '');
  const targetPath = suppliedTargetPath
    .split('/')
    .map((part) => validateSegment(part, 'Target path segment', config.portable_paths))
    .join('/');
  if (!targetPath || targetPath !== suppliedTargetPath) {
    throw new RequestError('Request target path metadata is not normalized.');
  }

  const { urls: existingUrls, paths: existingPaths } = readGitmodules(root);
  if (
    config.prevent_duplicate_repository
    && existingUrls.some((url) => repositoryKey(url) === repositoryKey(repositoryUrl))
  ) {
    throw new RequestError('The same repository is already registered in .gitmodules.');
  }
  assertSafeTargetPath(
    root,
    targetPath,
    existingPaths,
    config.prevent_case_insensitive_path,
  );
  assertSafeParentDirectories(root, targetPath);
  const targetParent = dirname(join(root, ...targetPath.split('/')));
  mkdirSync(targetParent, { recursive: true });
  const relativeParent = relative(realpathSync(root), realpathSync(targetParent));
  if (
    isAbsolute(relativeParent)
    || relativeParent === '..'
    || relativeParent.startsWith(`..${sep}`)
  ) {
    throw new RequestError('The target path parent resolves outside the repository.');
  }

  const command = ['submodule', 'add'];
  if (branch) command.push('-b', branch);
  command.push('--', repositoryUrl, targetPath);
  runGit(command, {
    cwd: root,
    targetUrls: repositoryUrl,
    authenticatedHosts: config.authenticated_hosts,
  });

  const commitExists = runGit(
    ['-C', targetPath, 'cat-file', '-e', `${resolvedCommit}^{commit}`],
    { check: false, cwd: root },
  );
  if (commitExists.returncode !== 0) {
    const fetched = runGit(
      ['-C', targetPath, 'fetch', '--no-tags', 'origin', resolvedCommit],
      {
        check: false,
        cwd: root,
        targetUrls: repositoryUrl,
        authenticatedHosts: config.authenticated_hosts,
      },
    );
    if (fetched.returncode !== 0) {
      throw new RequestError('The validated remote commit is no longer available.');
    }
  }

  runGit(['-C', targetPath, 'checkout', '--detach', resolvedCommit], { cwd: root });
  if (workingTreeCommit(root, targetPath).toLowerCase() !== resolvedCommit) {
    throw new RequestError('The applied submodule commit does not match the validated commit.');
  }
  runGit(['add', '--', targetPath], { cwd: root });
  const staged = runGit(['ls-files', '--stage', '--', targetPath], { cwd: root }).stdout;
  if (!staged.startsWith(`160000 ${resolvedCommit} `)) {
    throw new RequestError('The staged gitlink does not match the validated commit.');
  }
}

function commandGithubOutput(options) {
  const result = loadJson(required(options, 'request'));
  if (!result.valid) {
    throw new RequestError(result.error || 'Request is invalid.');
  }
  validatedRequestResolution(result.request);
  const markdownPath = required(options, 'markdown');
  const markdown = approvalMarkdown(result.request, required(options, 'issue'));
  const outputs = [];
  for (const key of [
    'repository_url',
    'repository_name',
    'target_path',
    'branch',
    'remote_default_branch',
    'resolved_branch',
    'resolved_commit',
  ]) {
    const value = String(result.request?.[key] || '');
    validateNoControls(value, key);
    outputs.push(`${key}=${value}`);
  }
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, markdown, 'utf8');
  process.stdout.write(`${outputs.join('\n')}\n`);
}

function commandUpdate(options) {
  const root = resolve(options.root || '.');
  const config = loadConfig(options.config || '.github/submodule-manager.json');
  const requestedPath = typeof options.path === 'string' ? options.path : '';
  const { selected, changes } = updateSubmodules(
    root,
    requestedPath,
    config.authenticated_hosts,
  );
  const result = {
    changed: changes.length > 0,
    requested_path: requestedPath.trim(),
    selected,
    changes,
  };
  writeJson(required(options, 'output'), result);
  writeFileSync(required(options, 'markdown'), updateMarkdown(selected, changes, requestedPath), 'utf8');
}

function commandUpdateOutput(options) {
  const result = loadJson(required(options, 'result'));
  const changes = Array.isArray(result.changes) ? result.changes : [];
  const selected = Array.isArray(result.selected) ? result.selected : [];
  process.stdout.write(`changed=${result.changed ? 'true' : 'false'}\n`);
  process.stdout.write(`changed_count=${changes.length}\n`);
  process.stdout.write(`selected_count=${selected.length}\n`);
}

function commandStageUpdate(options) {
  const result = loadJson(required(options, 'result'));
  const changes = Array.isArray(result.changes) ? result.changes : [];
  const paths = changes.map((change) => String(change.path));
  if (paths.length === 0) {
    throw new RequestError('No updated submodule paths to stage.');
  }
  for (const path of paths) validateNoControls(path, 'Submodule path');
  runGit(['add', '--', ...paths], { cwd: resolve(options.root || '.') });
}

export function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCli(argv);
  switch (command) {
    case 'inspect':
      commandInspect(options);
      break;
    case 'apply':
      commandApply(options);
      break;
    case 'github-output':
      commandGithubOutput(options);
      break;
    case 'update':
      commandUpdate(options);
      break;
    case 'update-output':
      commandUpdateOutput(options);
      break;
    case 'stage-update':
      commandStageUpdate(options);
      break;
    default:
      throw new RequestError(`Unknown command: ${command}`);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  }
}
