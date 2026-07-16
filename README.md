# Submodule Collection Template

**English** | [한국어](README_KR.md)

[![Use this template](https://img.shields.io/badge/Use%20this-template-2ea44f?logo=github)](../../generate)

A GitHub repository template for managing a collection of Git repositories as submodules.

Instead of manually editing `.gitmodules`, gitlinks, and paths whenever a submodule is added, users can submit a repository and target path through an Issue Form. GitHub Actions validates the request and creates a pull request automatically.

## Features

- Accept a repository and parent path through an Issue Form
- Generate the final directory name from the repository name
- Optionally override the directory name and tracked branch
- Verify repository accessibility and branch existence
- Detect duplicate repositories and duplicate paths
- Support Unicode, spaces, apostrophes, semicolons, and similar path characters
- Show validation errors and the final path in an issue comment
- Create a pull request only after a maintainer with write access comments `/approve`
- Manually update all submodules or one selected submodule from the Actions page
- Create an update pull request only when a newer commit is available
- Optionally access private GitHub repositories with a separate token
- Use dependency-free, plain Node.js with no installation step

## Workflow

```text
Submit the Issue Form
      ↓
Validate repository, path, and duplicates
      ↓
Preview the final path in an issue comment
      ↓
A maintainer comments /approve
      ↓
Create a branch and pull request for the submodule
      ↓
Review and merge
```

Manual updates work as follows:

```text
Actions → Update submodules → Run workflow
      ↓
Resolve the tracked branch for all or one submodule
      ↓
Update gitlinks to the latest remote commits
      ↓
Create a pull request only when changes exist
      ↓
Review and merge
```

## Getting Started

### 1. Create a repository from the template

Use the **Use this template** button above, or follow these steps on GitHub:

1. Click `Use this template`.
2. Select `Create a new repository`.
3. Choose the repository name and visibility.
4. Create the repository.

GitHub copies the files and directory structure from this template into the new repository.

### 2. Enable Issues

Open:

```text
Settings → General → Features → Issues
```

Enable `Issues` if it is disabled.

For a managed collection, select `Collaborators only` from the dropdown next to `Issues`. This prevents outside users from opening request issues and triggering preview workflow runs. The restriction applies to every new issue in the repository, not only the submodule request form. See [GitHub's Issues setting documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-issues).

### 3. Grant GitHub Actions write permissions

Open:

```text
Settings → Actions → General → Workflow permissions
```

Enable:

- `Read and write permissions`
- `Allow GitHub Actions to create and approve pull requests`

Without these settings, request validation can still run, but pushing a branch or creating a pull request may fail.

### 4. Request a submodule

Open:

```text
Issues → New issue → Add a submodule
```

The form contains these fields:

| Field | Required | Description |
| --- | --- | --- |
| Repository | Yes | `owner/repository` or a GitHub HTTPS URL |
| Parent path | Yes | Parent directory for the submodule. Use `.` for the repository root |
| Directory name | No | Uses the repository name when left empty |
| Branch | No | Uses the remote repository's default branch when left empty |
| Confirmation | Yes | Confirms that the repository and parent path were reviewed |

Example:

```text
Repository: example/example
Parent path: collections
Directory name: example
Branch: main
Confirmation: checked
```

Resulting path:

```text
collections/example
```

Creating or editing the issue triggers a workflow that posts the validation result and final path as a comment.

### 5. Approve the request

After reviewing a successful validation result, a user with `write`, `maintain`, or `admin` permission can comment:

```text
/approve
```

The workflow verifies the approver's repository permission and validates the latest issue content again. It then:

1. Creates a `submodule/issue-<issue number>` branch.
2. Runs `git submodule add`.
3. Commits `.gitmodules` and the gitlink.
4. Creates a pull request.
5. Posts the pull request URL on the issue.

The pull request body contains `Closes #<issue number>`, so merging it also closes the request issue.

## Manually Updating Submodules

To update registered submodules to their latest tracked commits, open:

```text
Actions → Update submodules → Run workflow
```

The optional `path` input controls the update scope:

| Input | Behavior |
| --- | --- |
| Empty | Update every submodule registered in `.gitmodules` |
| Exact path | Update only the selected submodule |

Example path:

```text
collections/example
```

The value must exactly match a `path` entry in `.gitmodules`. If it is missing or misspelled, the workflow fails and lists the available paths in the log.

The update workflow selects the target commit using these rules:

1. When the submodule has a `branch` entry in `.gitmodules`, update to the latest commit on that branch.
2. Otherwise, update to the latest commit on the remote repository's default branch.

For example, this submodule tracks `main`:

```ini
[submodule "collections/example"]
    path = collections/example
    url = https://github.com/example/example.git
    branch = main
```

When updates exist, the workflow creates a branch and pull request such as:

```text
submodule/update-<workflow run id>
```

The pull request lists the previous and updated commits for each changed submodule. When every selected submodule is already current, no branch or pull request is created; the result appears only in the workflow summary.

> Manual updates do not copy files from submodule repositories into the collection repository. They only update the gitlink commits referenced by the collection.

## Supported Repository Inputs

The default configuration accepts GitHub HTTPS repositories only.

These inputs are normalized to the same repository:

```text
example/example
https://github.com/example/example
https://github.com/example/example.git
```

Normalized result:

```text
https://github.com/example/example.git
```

SSH URLs, `file://` URLs, embedded credentials, query strings, and fragments are rejected.

## Restricting Repository Owners

Use the `whitelist_owner` array near the top of `scripts/submodule-manager.mjs` to restrict which repository owners can be added.

The default empty array allows every owner:

```js
export const whitelist_owner = [];
```

Add owner names to permit only selected users or organizations:

```js
export const whitelist_owner = [
  'example',
  'example-org',
];
```

When the array contains at least one value, only repositories owned by a listed owner are accepted. Owner matching is case-insensitive, matching GitHub's behavior.

```text
example/example         → allowed
example-org/example     → allowed
other-owner/example     → rejected
```

For a full HTTPS URL, the first path segment after the hostname is treated as the owner.

## Configuration

Customize behavior in `.github/submodule-manager.json`:

```json
{
  "allowed_hosts": [
    "github.com"
  ],
  "authenticated_hosts": [
    "github.com"
  ],
  "allow_root": true,
  "portable_paths": true,
  "prevent_duplicate_repository": true,
  "prevent_case_insensitive_path": true
}
```

### `allowed_hosts`

A list of HTTPS Git hosts that requests may use.

```json
{
  "allowed_hosts": [
    "github.com",
    "git.example.com"
  ]
}
```

The `owner/repository` shorthand always resolves to `github.com`. Use a complete HTTPS URL for another host.

### `authenticated_hosts`

The subset of `allowed_hosts` that may receive `SUBMODULE_TOKEN`. The default contains only `github.com`; keep a public custom host out of this list. Add a private custom host explicitly only when the token is scoped for that host.

```json
{
  "allowed_hosts": [
    "github.com",
    "git.example.com"
  ],
  "authenticated_hosts": [
    "github.com"
  ]
}
```

### `allow_root`

When `true`, users can enter `.` as the parent path to add a submodule at the repository root.

### `portable_paths`

When `true`, the validator rejects reserved names and characters that can prevent checkout on Windows. Unicode, spaces, apostrophes, and semicolons remain supported.

### `prevent_duplicate_repository`

Rejects a request when `.gitmodules` already contains the same repository URL. GitHub URLs are compared after normalizing case and an optional `.git` suffix.

### `prevent_case_insensitive_path`

Rejects paths that would collide on a case-insensitive file system.

For example, when `Collections/Example` already exists, `collections/example` is also considered a duplicate.

## Private Submodules

The default `GITHUB_TOKEN` is limited to the collection repository and may not be able to read another private repository.

To add private repositories, create a `SUBMODULE_TOKEN` Actions secret in the collection repository. For a host that does not accept `x-access-token` as the HTTPS username, also create `SUBMODULE_TOKEN_USERNAME` with the required username:

```text
Settings → Secrets and variables → Actions → New repository secret
```

Recommended permissions:

- Use a fine-grained personal access token.
- Grant only `Contents: Read-only` on the target private repositories.
- Do not grant write access to the collection repository.
- Use the shortest practical expiration period.

The token is used only after a write-authorized `/approve` to revalidate and add a target submodule, and during a manual update, on `authenticated_hosts`. Public issue previews never receive this token, so a private repository can appear unreachable until an authorized collaborator approves it. Target Git commands explicitly discard the collection checkout credential before applying this token. Branches in the collection repository are pushed with the default `GITHUB_TOKEN`.

## Validation Rules

A request must satisfy all of the following:

- Use an HTTPS repository on an allowed host
- Use the host's default HTTPS port
- Point to an accessible repository
- Reference an existing branch when a branch is specified
- Include the checked confirmation from the Issue Form
- Use a relative path
- Contain no `.` or `..` path segments
- Avoid paths inside `.git`
- Contain no control characters or line breaks
- Not duplicate an equivalent HTTPS, SSH, or scp-style repository already registered in `.gitmodules`
- Not collide with tracked paths on case-insensitive file systems
- Not traverse a symbolic link in an existing parent path

Approval binds the inspected branch and commit to the gitlink staged in the pull request. If the remote moves after inspection, the workflow checks out the inspected commit or fails without pushing a pull request.

User input is never concatenated into a shell command. After validation, the Node.js script passes values as separate arguments through `child_process`.

The manager uses only the Node.js standard library. Workflows call the Node.js version already installed on GitHub-hosted `ubuntu-latest` runners and do not run `actions/setup-node`, `npm install`, or `npm ci`. Actual workflow duration is generally dominated by runner startup and remote Git operations.

## Publishing This Template

After pushing this project to GitHub, enable template mode at:

```text
Settings → General → Template repository
```

Once enabled, GitHub displays the `Use this template` button at the top of the repository.

The badge at the top of this README uses a relative link, so renaming the template repository does not require updating the badge URL.

## Project Structure

```text
.
├── .github
│   ├── ISSUE_TEMPLATE
│   │   ├── add-submodule.yml
│   │   └── config.yml
│   ├── workflows
│   │   ├── approve-submodule-request.yml
│   │   ├── preview-submodule-request.yml
│   │   └── update-submodules.yml
│   └── submodule-manager.json
├── scripts
│   └── submodule-manager.mjs
├── LICENSE
├── README.md
└── README_KR.md
```

## Notes

- Pull requests created by the workflow are never merged automatically.
- Editing a request issue refreshes its preview comment.
- The latest issue content is validated again when `/approve` is submitted.
- If the issue's automation branch already has a pull request, another one is not created. An orphan branch without a pull request is preserved, and the retry uses a new run-specific branch.
- Pull requests created with the default `GITHUB_TOKEN` may not trigger other workflows. Use a GitHub App or another token if additional CI must run after pull-request creation.

## License

MIT License
