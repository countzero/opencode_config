# AGENTS.md

Global agent instructions: opencode loads this file into every session, in every
project, next to the project's own `AGENTS.md`. It carries only the personal
rules that hold everywhere, one invariant per area. Where a project's
`AGENTS.md` says otherwise, the project wins.

## Version Control

Commit only when explicitly asked, push only when explicitly asked, and "commit"
does not imply "push". No `Co-Authored-By` trailer.

## Browser Slots

Every opencode process drives its own Chrome profile, and `CHROME_SLOT` in the
shell names it. Chrome processes of another slot belong to another opencode
window: never kill, close or reuse them. Kill only processes whose command line
carries `opencode-profile-$env:CHROME_SLOT`, and refuse when `CHROME_SLOT` is
unset.

## Output Formatting

Pad every cell of a markdown table so all cells of a column share one width.
The em dash is reserved for interrupted dialogue and a genuine break in
thought; everywhere else use the specific mark. American spelling in code,
comments and English prose.

## Skills

Each skill's own description says when to load it.

| Skill         | Purpose                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `plan-review` | Second pass over a non-trivial plan through ten design lenses            |
| `trim-prose`  | Editing pass over the comments and documents a branch adds or changes    |
