---
name: trim-prose
description: >
  Editing pass over the comments and documents a branch adds or changes. Cuts
  history lessons, the route to a decision, meta-commentary and the obvious,
  keeps the failure mode a rule prevents, and reports the lines and words
  removed. Use when asked to go through, tighten, shorten, or re-read the
  updated comments and docs of a branch, before opening a pull request whose
  prose has not been re-read, or when the user types /trim-prose. Edits the
  working tree; never commits.
---

# Trim Prose

This is the recipe for one editing pass over one branch's prose. What a comment
or a document is for is the repository's own rule: read its `AGENTS.md` first,
and where it points at a conventions or documentation guide, that guide wins
over anything below.

The blocks are bash. On Windows they run in Git Bash, called by its path
(`& "$env:ProgramFiles\Git\bin\bash.exe" -c '…'` from PowerShell): a bare
`bash` resolves to `C:\Windows\System32\bash.exe`, the WSL launcher, whose
Linux git sees the tree through `/mnt/` under different line-ending and
file-mode rules. PowerShell's quoting breaks the `-z` pipelines.

## Scope

Read the branch's own prose, committed and uncommitted. The base branch is the
one the pull request targets; `origin/main` below stands for it:

```bash
git fetch origin
BASE=$(git merge-base origin/main HEAD) || exit 1   # the pull request's base
[ -n "$BASE" ] || exit 1                     # empty reads as an ordinary diff
SCRATCH="${TMPDIR:-/tmp}/trim-<session-id>"; mkdir -p "$SCRATCH"
git stash create > "$SCRATCH/pre"            # a commit object; the tree is untouched
[ -s "$SCRATCH/pre" ] || git rev-parse HEAD > "$SCRATCH/pre"
git diff "$BASE" --stat
git diff --stat
git ls-files --others --exclude-standard     # git diff never shows these
```

Where the repository's `AGENTS.md` names a scratch directory, `SCRATCH` goes
there instead.

Then record what the tree held, so *Prove* can show the pass touched nothing it
did not mean to:

```bash
: "${SCRATCH:?}"
ROOT=$(git rev-parse --show-toplevel) || exit 1
[ -n "$ROOT" ] || exit 1                        # an empty ROOT makes it all vacuous
printf '%s\n' "$ROOT" > "$SCRATCH/root"         # Prove reads this back, never re-derives
{ git -C "$ROOT" diff HEAD --name-only -z
  git -C "$ROOT" ls-files --others --exclude-standard -z; } |
  sort -zu > "$SCRATCH/dirty-before"
c=0
while IFS= read -r -d '' f; do
  c=$((c+1))
  if [ -e "$ROOT/$f" ]; then printf '%s %s\0' "$(git hash-object --no-filters -- "$ROOT/$f")" "$f"
  else printf 'absent %s\0' "$f"; fi
done < "$SCRATCH/dirty-before" > "$SCRATCH/digests-before"
printf '%s\n' "$c" > "$SCRATCH/digests-count"   # a path may hold a newline: count here
```

`git stash create` records the tree as the pass found it without touching a
file, and *Report* diffs against it so the counts describe this pass rather than
everything uncommitted in the tree.

**`BASE` and `SCRATCH` die with the shell call that set them.** The blocks below
open with `: "${BASE:?}"` or `: "${SCRATCH:?}"`, which stop the call rather than
let an empty variable be read as an argument, so re-run the block above in any
call that needs them.

The `ls-files` line is not redundant: an untracked file appears in no diff, so a
document the branch added and has not staged would go unread and the pass would
report itself clean. Read each one whole; every line of a new file is an added
line. The records are NUL-terminated because a newline-terminated record splits
in two where a path holds a newline, and the count is taken from the loop so it
cannot agree with such a corruption.

**Uncommitted prose may not be yours.** A working tree can be shared with other
agents or colleagues. Before editing a dirty file, establish whose the dirty
hunks are; a file carrying both your findings and someone else's edits stops the
pass and goes to the user. Re-wrapping a paragraph around a foreign sentence is a
change nobody asked for and nobody can easily unpick.

Then read the **added lines**, not the files:

```bash
: "${BASE:?}"
git diff "$BASE" -U0 | grep -E '^(@@|\+)'
```

`+++ b/<path>` and `@@` survive that filter on purpose: without them a struck
phrase cannot be located again, and *Report* wants every finding anchored to
where it was found.

In scope: a `+` line inside a `/** */` or after `//`, `#`, `<!--`; every `.md`,
`README.md`, `SKILL.md`; a comment header in a committed config file. Out of
scope: code, identifiers, tests, generated files, `CHANGELOG.md`, and any file
the repository's security rules forbid reading, such as `.env`.

## Cut

Each category is a test with a yes/no answer. A sentence that is merely long is
not a finding.

| Cut                   | The test                                                             |
| --------------------- | -------------------------------------------------------------------- |
| History lesson        | Does it say what the code, the file or the rule **used to** be?      |
| Route to the decision | Does it narrate how the decision was reached instead of stating it?  |
| Meta-commentary       | Is the subject the prose itself rather than the thing it describes?  |
| The obvious           | Would the code beside it, or the sentence before it, already say so? |
| Second copy           | Does this rationale already have an authoritative home?              |
| Ticket key            | Any issue key in a comment, a JSDoc or a test name?                  |
| Inventory             | Is it a count or a list the file system itself answers?              |

A *second copy* is replaced by a pointer to its home (`` `docs/<file>.md` →
*Section* ``), never deleted outright. A *ticket key* is struck on sight where
the repository keeps history in git rather than in comments; its `AGENTS.md`
says which. An *inventory* goes when nobody reasons about the number ("the five
containers"); a domain constant that carries meaning stays.

## Keep

Cutting these is the failure mode of this pass:

- **The failure mode a rule prevents.** "A repeated label hands one stack's
  containers to two slots" is the reason the rule exists, and the reader cannot
  re-derive it.
- **A measured number.** "Two calls cost 306 ms where one costs 145 ms."
- **A constraint from outside the repository.** A platform quirk, an upstream
  bug, a vendor's undocumented behavior.
- **The one authoritative statement** of a rationale, at its definition, however
  long it has to be.
- **Test structure markers** such as `// Arrange` / `// Act` / `// Assert`.

## Verify

Before reporting, run whatever the repository's `AGENTS.md` names for lint and
consistency, on each changed code file at least, because a line-length rule
applies to a comment line too. Where it states size budgets for its documents,
measure them. Re-wrap every paragraph touched to the width the file already
uses; a half-rewrapped paragraph is a larger diff than the edit inside it. Say
plainly when a command fails for a reason the pass did not cause.

## Report

The counts, because a pass that changed nothing should be visible as such:

```bash
: "${SCRATCH:?}"
PRE=$(cat "$SCRATCH/pre")                    # the tree as this pass found it
git diff "$PRE" --numstat | awk '{a+=$1; d+=$2} END {print a, d}'
git diff "$PRE" -U0 --output-indicator-old='<' | grep '^<' | sed 's/^<//' | wc -w
git diff "$PRE" -U0 --output-indicator-new='>' | grep '^>' | sed 's/^>//' | wc -w
```

Every count is against *Scope*'s snapshot, not a bare `git diff`, which would
also credit this pass with whatever was already uncommitted. Edits to an
**untracked** file appear in no diff at all, so count those by reading the file.
`--output-indicator-old` re-marks the deleted lines so the `--- a/<path>` header
can stay; filtering that header by pattern would also drop every deleted line
beginning `--`, such as a front-matter delimiter.

Present one table (deleted, added, net for lines and words), then the findings
grouped by cut category, each with the struck phrase. Most deleted lines are
rewrites, so the net figure is the real reduction.

## Prove

Before reporting, and from the repository root:

```bash
: "${SCRATCH:?}"
ROOT=$(cat "$SCRATCH/root" 2>/dev/null); n=0
{ [ -n "$ROOT" ] && [ -r "$SCRATCH/digests-count" ]; } ||
  echo "PROOF INCOMPLETE: no capture ran"
cat "$SCRATCH/edited-by-hand" > "$SCRATCH/edited" 2>/dev/null || : > "$SCRATCH/edited"
while IFS= read -r -d '' rec; do
  n=$((n+1)); h=${rec%% *}; f=${rec#* }
  grep -qxF "$f" "$SCRATCH/edited" && continue  # an edit this pass made on purpose
  if [ "$h" = absent ]; then [ -e "$ROOT/$f" ] && echo "reappeared: $f"
  elif [ "$(git hash-object --no-filters -- "$ROOT/$f")" != "$h" ]; then echo "moved: $f"; fi
done < "$SCRATCH/digests-before"
[ "$n" = "$(cat "$SCRATCH/digests-count" 2>/dev/null)" ] || echo "PROOF INCOMPLETE: $n"
:
```

Those digests cover only what was dirty or untracked when the pass started, so a
second block measures the whole tree against *Scope*'s snapshot:

```bash
: "${SCRATCH:?}"
ROOT=$(cat "$SCRATCH/root" 2>/dev/null)
{ [ -n "$ROOT" ] && [ -r "$SCRATCH/pre" ]; } || echo "PROOF INCOMPLETE: no snapshot"
[ -r "$SCRATCH/edited" ] || : > "$SCRATCH/edited"   # the block above writes it
git -C "$ROOT" diff "$(cat "$SCRATCH/pre")" --name-only -z |
  while IFS= read -r -d '' f; do
    grep -qxF "$f" "$SCRATCH/edited" || echo "undeclared: $f"
  done
:                                               # must print nothing
```

**Append every file you edit to `$SCRATCH/edited-by-hand`**, one root-relative
path per line, as you edit it. It is the only thing that separates an edit this
pass chose from damage it did not; a file edited but never written down is
reported as `undeclared:` or `moved:`, a false alarm, which is the direction
this proof has to fail in.

Silence is the pass. A name printed is a file whose bytes moved without this
pass choosing to edit it; `reappeared:` is a file that was deleted when the pass
started and is back. `PROOF INCOMPLETE` means the capture never ran, which is
not the same as a clean tree: `digests-count` holding `0` is a clean tree.

Three details make the proof hold. `$ROOT` is read back rather than re-derived,
because a working directory outlives the call that set it and a pass that
`cd`s into a worktree would otherwise compare it against the wrong digests.
`-z` keeps non-ASCII filenames unquoted, so they match the list you wrote by
hand. `--no-filters` makes the digest a byte comparison: without it, under
`core.autocrlf` or a `text=auto` attribute, a file whose line endings the pass
rewrote hashes to the digest it started with.

## Don't

- Don't rewrite a passage no category above caught.
- Don't edit a file whose dirty hunks are not yours, and don't re-wrap a
  paragraph around a foreign sentence; hand the file to the user instead.
- Don't touch code, identifiers or test names; a rename is a different ask.
- Don't strip em dashes mechanically.
- Don't commit or push, and don't install dependencies to repair a red command.
- Don't report a pass whose *Prove* printed a name; that is a file this pass
  damaged, not a finding to write up.
