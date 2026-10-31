---
name: ngit-pr
description: Opening, revising or merging a PR via `gh` (GitHub) or `ngit` (nostr proposals: `pr/*` branches, gitworkshop.dev, `nostr://` remote). Use when a PR task touches either path; finds remotes by URL, covers the build gate, the three-mains gate and slow pushes.
---

# Pull requests: GitHub **and** git-over-nostr

This repo can be contributed to **two** ways, via **two kinds** of remote. Both end up in GitHub `main`.
Open a PR at all only when the human you work for asks.

| Remote kind | URL pattern | Role |
|--|--|--|
| **GitHub** | `github.com/vitorpamplona/sheetstr` | **Canonical** `main`. Standard `gh` PR flow. |
| **git-over-nostr** | `nostr://…/relay.ngit.dev/sheetstr` | `ngit`. A push fans out to the GRASP git servers (relay.ngit.dev, gitnostr.com, git.shakespeare.diy) **and** GitHub, and publishes the repository state as a nostr event. PRs are **proposals** (`pr/*` branches), reviewed on gitworkshop.dev, *not* GitHub PRs. |

The repository is announced by the maintainer, `npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z`; browse it at <https://gitworkshop.dev/npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z/relay.ngit.dev/sheetstr>.

## Step 0: identify YOUR remotes (names are not universal)

Remote **names are per-clone**: `ngit init` and `git clone nostr://…` make the nostr remote `origin` and keep GitHub as `github`, a plain GitHub clone has GitHub as `origin`, and **you may have only one**. Detect by **URL**, never assume a name:

```bash
git remote -v
GH_REMOTE=$(git remote -v    | awk '/github\.com/   {print $1; exit}')   # may be empty
NOSTR_REMOTE=$(git remote -v | awk '/nostr:\/\//     {print $1; exit}')  # may be empty
# add the one you lack:
git remote add github https://github.com/vitorpamplona/sheetstr
git remote add nostr nostr://npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z/relay.ngit.dev/sheetstr
```

## Which path?

| | **GitHub path** (`gh`) | **nostr path** (`ngit`) |
|--|--|--|
| Needs | a GitHub remote + `gh auth status` (or your GitHub tools) | a `nostr://` remote + `ngit` ≥ 3.0 (`ngit --version`; `ngit update --check`) |
| PR lives on | GitHub only | nostr + GRASP + GitHub (fans out) |
| Use when | Default. Simplest, no alignment gate. | The PR must be reviewable over nostr (gitworkshop), or you're revising/merging an existing **proposal** (`pr/*`). |

**Default to GitHub** unless the task is about a nostr proposal (a gitworkshop link, a `pr/*` branch, "the PRs on the nostr remote"). One remote decides it for you. Revise/merge a PR on **the same path it was created**.

## The build gate (both paths, every create, revise and merge)

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

There is no build, CI or test suite: serve the folder and check the sheet loads and saves. There is no git hook: run it by hand before every push, `ngit send` and merge.

An ngit merge publishes `main` directly, with no GitHub PR checks, so this gate is the only check it gets before landing. On the GitHub path, merge only once the PR's checks are green.

---

# GitHub path (`gh`)

Branch off `main`, `git push -u "$GH_REMOTE" feat/<slug>`, then
`gh pr create --repo vitorpamplona/sheetstr --base main --head feat/<slug>`.
Revise by pushing more commits to the same branch; review with `gh pr view <n> --repo vitorpamplona/sheetstr --comments`;
the maintainer merges with `gh pr merge <n> --merge` (or `--squash`) once `gh pr checks <n>` is green. GitHub is the source of truth here: no three-mains gate. The nostr `main` catches up on the next nostr push or `ngit sync --trust-server` (below).

---

# nostr path (`ngit`)

**Mental model:** a proposal is a *linear series of commits off `main`*, published as nostr events. A "revision" is a new version of that proposal. Merging applies the series to `main` and publishes an applied-status event. There is **no** PR number: a proposal is named by its event id, and a unique hex prefix of it works. `ngit pr merge` makes a plain (no-ff) merge commit. Full reference: `ngit <command> --help`, <https://ngit.dev/pull-requests>.

## The three-mains alignment gate (the thing that breaks everything)

Up to **three** `main` heads drift apart:

- GitHub main (`$GH_REMOTE/main`): newest; PRs merged on GitHub land here only
- nostr main (`$NOSTR_REMOTE/main`): **lags** until someone pushes to the nostr remote or syncs
- local `main`

**Every create/revise/merge requires the proposal's base to equal the nostr `main`, and pushing `main` to the nostr remote requires GitHub's main to be an ancestor of what you push.** When misaligned, ngit **rejects pre-flight and publishes nothing** (safe: realign and retry). Don't `--force` past it.

```bash
git fetch --all
echo "github=$([ -n "$GH_REMOTE" ] && git rev-parse "$GH_REMOTE/main")  \
nostr=$(git ls-remote "$NOSTR_REMOTE" -h refs/heads/main | awk '{print $1}')  \
local=$(git rev-parse main)"
# all present heads equal → proceed.
# local behind GitHub?  git merge --ff-only "$GH_REMOTE/main"  (or "$NOSTR_REMOTE/main" if that's all you have)
# nostr behind GitHub?  ngit sync --trust-server   (moves nostr state up to GitHub; clean fast-forwards only)
#                       or, with local main == GitHub main: git push "$NOSTR_REMOTE" main
```

With **only** the nostr remote: align local `main` to `$NOSTR_REMOTE/main`; GitHub is handled by fan-out. If GitHub diverged from nostr (`out of sync with nostr` on push, not a fast-forward), that's a maintainer `ngit sync --ref-name main --force` situation: **stop and ask the human**, never run a forced sync unprompted.

## Pushes are slow: run them in the background

`git push "$NOSTR_REMOTE" …`, `ngit send` and `ngit sync` fan out to relays + GRASP servers + GitHub and **routinely exceed 2 minutes**. Run them as a background command and poll (e.g. `git ls-remote "$NOSTR_REMOTE"` for the expected ref); a foreground call hits the tool timeout even while the push is succeeding.

## Identity

`ngit account whoami` shows the signing key; `ngit send`, `ngit sync` and the push after `ngit pr merge` sign with **that** key regardless of who wrote the commits. Only the maintainer's key can move `main`; anyone can open a proposal.

## List / view

```bash
ngit pr list                                   # open + draft
ngit pr list --status open,draft,closed,applied
ngit pr view <id | unique-hex-prefix | nevent> --comments
ngit pr checkout <id>                          # local tracking branch for someone else's proposal
```

Status `applied` == merged. ngit 3 does not fetch other people's proposals as branches: `ngit pr checkout <id>` fetches one (as `pr/<slug>(<short-id>)`; the `(...)` is an ngit annotation, the real ref is `pr/<slug>`). `git config nostr.auto-pr-branches true` fetches them all.

## Create

Push a `pr/`-prefixed branch (linear, off the aligned `main`):

```bash
git push -o 'title=My title' -o 'description=line1\n\nline2' -u "$NOSTR_REMOTE" pr/feat/<slug>
```

Your own proposal: amend or rebase, then `git push --force "$NOSTR_REMOTE" pr/feat/<slug>` publishes the new version. Longer descriptions (real newlines): `ngit send main --subject … --description "$(cat pr.md)"` instead of a `pr/` push, never both. Labels, target branch, stacks: `ngit send --help`.

## Revise someone else's proposal (publish a new version)

The revision must be a **linear series off the current `main`** (a merge commit is the wrong shape).

```bash
# 1. align (gate above), then build the linear series:
git checkout -b <work> main
git cherry-pick <original-pr-tip>      # existing PR commits
git cherry-pick <your-new-commits…>    # yours on top   (or: git rebase main)

# 2. the build gate: must pass before you send.

# 3. publish as a new version, linked to the proposal:
ngit send main --in-reply-to <proposal-id> \
  --subject "<keep or update title>" \
  --description "<what changed>"       # commits in main..HEAD
```

`--in-reply-to` threads it under the same proposal on gitworkshop. **No `--force`** once the base equals the nostr `main`. Verify: `git ls-remote "$NOSTR_REMOTE" | grep <short-id>` shows `refs/pr/<full-id>/head` at your new tip.

## Merge into main (maintainer)

The merge is **local**; the applied-status event publishes on the push that follows.

```bash
# 1. ALIGN (mandatory): all present mains equal.
git checkout main
ngit pr merge <proposal-id>             # local no-ff merge commit "Merge #<8-hex>: <title>"
git log --merges --oneline "$NOSTR_REMOTE/main"..HEAD   # one merge only; a nested `Merge #…` means rebase the PR first

# 2. the build gate on the merged tree, then sanity-check and publish (background: slow):
[ -n "$GH_REMOTE" ] && { git merge-base --is-ancestor "$GH_REMOTE/main" HEAD && echo "clean FF push" || echo "github moved; realign"; }
git push "$NOSTR_REMOTE" main
```

Confirm: `ngit pr list --status applied` shows it, and `git fetch "$GH_REMOTE"` fast-forwards GitHub's main to your merge.

## Cleanup

Delete throwaway branches pushed to the nostr remote with `git push "$NOSTR_REMOTE" --delete <branch>` (per-GRASP "non-existent ref" warnings are harmless fan-out). Delete the local `pr/…` branches `ngit pr checkout` made and your work branch.

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `proposal builds on a commit N ahead of 'origin/main'` | base ≠ stale nostr `main` | realign `main`, rebase the series, resend (no `--force`) |
| `! [remote rejected] main … out of sync with nostr` | GitHub main moved past nostr | clean fast-forward: `ngit sync --trust-server`; diverged: maintainer `ngit sync --ref-name main --force`, **ask the human** |
| push "succeeds" but nothing on gitworkshop | pushed a plain branch, not a proposal | use the `pr/` prefix or `ngit send` |
| `ngit pr view`/`merge` lists several matches | the hex prefix is ambiguous | pass a longer prefix, the full id or the `nevent` |
| push hangs / times out at 2 min | normal GRASP fan-out latency | run in background; verify via `git ls-remote` |
| GitHub rejects the fan-out push | no GitHub credentials on this machine | the GRASP servers still took it; push `main` to `$GH_REMOTE` too, or have the maintainer sync |
