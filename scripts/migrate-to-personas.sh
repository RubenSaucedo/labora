#!/usr/bin/env bash
# One-off, globally preflighted migration:
# data/applicant/<name>/ -> data/personas/<name>/
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

OLD_ROOT="data/applicant"
NEW_ROOT="data/personas"
PLAN_FILE="$(mktemp "${TMPDIR:-/tmp}/resume-migration.XXXXXX")"
trap 'rm -f "$PLAN_FILE"' EXIT

plan_move() {
  local source="$1" target="$2"
  [ -f "$source" ] || return 0
  if [ -e "$target" ] || awk -F '	' -v target="$target" '$2 == target { found=1 } END { exit !found }' "$PLAN_FILE"; then
    echo "collision: $source -> $target" >&2
    exit 1
  fi
  printf '%s\t%s\n' "$source" "$target" >> "$PLAN_FILE"
}

plan_tree() {
  local source_root="$1" target_root="$2"
  [ -d "$source_root" ] || return 0
  while IFS= read -r -d '' source; do
    [ "$(basename "$source")" = ".DS_Store" ] && continue
    local relative="${source#"$source_root"/}"
    plan_move "$source" "$target_root/$relative"
  done < <(find "$source_root" -type f -print0)
}

echo "== preflighting all personas"
for persona_dir in "$OLD_ROOT"/*/; do
  [ -n "$(ls -A "$persona_dir" 2>/dev/null)" ] || continue
  name="$(basename "$persona_dir")"
  target_root="$NEW_ROOT/$name"

  plan_move "$persona_dir/$name-career.md" "$target_root/profile/career.md"
  # The v1 context file fused contact details with self-reported facts. It lands
  # in background.md; contact lines must then be moved by hand into contact.md,
  # which is intentionally excluded from the claim-grounding corpus.
  plan_move "$persona_dir/$name-context.md" "$target_root/profile/background.md"
  plan_move "$persona_dir/$name-story.md" "$target_root/profile/story.md"
  plan_move "$persona_dir/general-resume.json" "$target_root/profile/identity.json"

  plan_tree "$persona_dir/connects-pdf" "$target_root/evidence/performance-reviews/raw"
  plan_tree "$persona_dir/connects-md" "$target_root/evidence/performance-reviews/text"
  plan_tree "$persona_dir/sample-resumes" "$target_root/evidence/references"

  for job in "$persona_dir"/jobs/*.md; do
    slug="$(basename "$job" .md)"
    plan_move "$job" "$target_root/applications/$slug/job.md"
  done
  for output_dir in "$persona_dir"/output/*/; do
    slug="$(basename "$output_dir")"
    plan_tree "$output_dir" "$target_root/applications/$slug"
  done
done

echo "== applying verified move plan"
mkdir -p "$NEW_ROOT"
while IFS=$'\t' read -r source target; do
  [ -n "$source" ] || continue
  mkdir -p "$(dirname "$target")"
  mv "$source" "$target"
done < "$PLAN_FILE"

for persona_dir in "$OLD_ROOT"/*/; do
  if [ -d "$persona_dir/connects-md-offuscated" ]; then
    rm -rf "$persona_dir/connects-md-offuscated"
  fi
  find "$persona_dir" -name ".DS_Store" -delete 2>/dev/null || true
  find "$persona_dir" -depth -type d -empty -delete 2>/dev/null || true
  if [ -d "$persona_dir" ]; then
    echo "leftover files in $persona_dir:" >&2
    find "$persona_dir" -type f -print >&2
  fi
done

rmdir "$OLD_ROOT" 2>/dev/null || true
echo "DONE"
